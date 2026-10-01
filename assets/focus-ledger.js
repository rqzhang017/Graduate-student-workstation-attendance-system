(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.FocusLedger = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function() {
    'use strict';

    const MINUTE_MS = 60 * 1000;
    const HOUR_MS = 60 * MINUTE_MS;
    const DAY_MS = 24 * HOUR_MS;

    function finiteNumber(value, fallback = 0) {
        if (value === null || value === undefined || value === '') return fallback;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    }

    function formatDateKey(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    }

    function parseDateKey(dateKey) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(year, month - 1, day);
        if (Number.isNaN(date.getTime())
            || date.getFullYear() !== year
            || date.getMonth() !== month - 1
            || date.getDate() !== day) {
            return null;
        }
        return date;
    }

    function normalizeRolloverHour(value) {
        const hour = Math.trunc(finiteNumber(value, 4));
        return Math.min(8, Math.max(0, hour));
    }

    function workDayKey(timestamp, rolloverHour = 4) {
        const date = new Date(finiteNumber(timestamp, Date.now()));
        date.setHours(date.getHours() - normalizeRolloverHour(rolloverHour));
        return formatDateKey(date);
    }

    function workDayBounds(dateKey, rolloverHour = 4) {
        const date = parseDateKey(dateKey);
        if (!date) return null;
        const hour = normalizeRolloverHour(rolloverHour);
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0);
        const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, hour, 0, 0, 0);
        return { startTimestamp: start.getTime(), endTimestamp: end.getTime() };
    }

    function emptyLedger() {
        return {
            version: 1,
            sessions: [],
            adjustments: [],
            migratedAt: null,
            migrationSummary: null
        };
    }

    function normalizeLedger(rawLedger) {
        const ledger = rawLedger && typeof rawLedger === 'object' ? rawLedger : {};
        return {
            version: 1,
            sessions: Array.isArray(ledger.sessions) ? ledger.sessions.filter(Boolean) : [],
            adjustments: Array.isArray(ledger.adjustments) ? ledger.adjustments.filter(Boolean) : [],
            migratedAt: ledger.migratedAt || null,
            migrationSummary: ledger.migrationSummary || null
        };
    }

    function normalizePauseIntervals(session, rangeEnd) {
        const pauses = Array.isArray(session && session.pauses) ? session.pauses : [];
        return pauses
            .map(pause => {
                const startTimestamp = finiteNumber(pause && (pause.startTimestamp ?? pause.start), NaN);
                const rawEnd = pause && (pause.endTimestamp ?? pause.end);
                const endTimestamp = finiteNumber(rawEnd, rangeEnd);
                return { startTimestamp, endTimestamp };
            })
            .filter(pause => Number.isFinite(pause.startTimestamp) && pause.endTimestamp > pause.startTimestamp)
            .sort((left, right) => left.startTimestamp - right.startTimestamp);
    }

    function getSessionRange(session, now = Date.now()) {
        const startTimestamp = finiteNumber(session && session.startTimestamp, NaN);
        if (!Number.isFinite(startTimestamp)) return null;
        const storedEnd = finiteNumber(session && session.endTimestamp, NaN);
        const endTimestamp = Number.isFinite(storedEnd) ? storedEnd : finiteNumber(now, Date.now());
        if (endTimestamp <= startTimestamp) return null;
        return { startTimestamp, endTimestamp };
    }

    function getEffectiveIntervals(session, now = Date.now()) {
        const range = getSessionRange(session, now);
        if (!range) return [];

        const pauses = normalizePauseIntervals(session, range.endTimestamp);
        const intervals = [];
        let cursor = range.startTimestamp;

        pauses.forEach(pause => {
            const pauseStart = Math.min(range.endTimestamp, Math.max(range.startTimestamp, pause.startTimestamp));
            const pauseEnd = Math.min(range.endTimestamp, Math.max(range.startTimestamp, pause.endTimestamp));
            if (pauseStart > cursor) {
                intervals.push({ startTimestamp: cursor, endTimestamp: pauseStart });
            }
            cursor = Math.max(cursor, pauseEnd);
        });

        if (cursor < range.endTimestamp) {
            intervals.push({ startTimestamp: cursor, endTimestamp: range.endTimestamp });
        }
        return intervals;
    }

    function getEffectiveDurationMs(session, now = Date.now()) {
        const override = finiteNumber(session && session.durationOverrideMs, NaN);
        if (Number.isFinite(override)) return Math.max(0, override);
        return getEffectiveIntervals(session, now).reduce(
            (sum, interval) => sum + interval.endTimestamp - interval.startTimestamp,
            0
        );
    }

    function splitIntervalByWorkDay(startTimestamp, endTimestamp, rolloverHour = 4) {
        const start = finiteNumber(startTimestamp, NaN);
        const end = finiteNumber(endTimestamp, NaN);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

        const segments = [];
        let cursor = start;
        let guard = 0;
        while (cursor < end && guard < 10000) {
            const dateKey = workDayKey(cursor, rolloverHour);
            const bounds = workDayBounds(dateKey, rolloverHour);
            if (!bounds) break;
            const segmentEnd = Math.min(end, bounds.endTimestamp);
            if (segmentEnd <= cursor) break;
            segments.push({ dateKey, startTimestamp: cursor, endTimestamp: segmentEnd, durationMs: segmentEnd - cursor });
            cursor = segmentEnd;
            guard += 1;
        }
        return segments;
    }

    function addDuration(target, key, durationMs) {
        if (!key || !Number.isFinite(durationMs) || durationMs === 0) return;
        target[key] = finiteNumber(target[key], 0) + durationMs;
    }

    function getSessionContributions(session, rolloverHour = 4, now = Date.now()) {
        const contributions = {};
        const durationOverrideMs = finiteNumber(session && session.durationOverrideMs, NaN);
        const legacyDate = session && session.legacyDate;

        if (session && session.legacy && legacyDate && Number.isFinite(durationOverrideMs)) {
            addDuration(contributions, legacyDate, Math.max(0, durationOverrideMs));
            return contributions;
        }

        const intervals = getEffectiveIntervals(session, now);
        if (intervals.length === 0) {
            if (legacyDate && Number.isFinite(durationOverrideMs)) {
                addDuration(contributions, legacyDate, Math.max(0, durationOverrideMs));
            }
            return contributions;
        }

        intervals.forEach(interval => {
            splitIntervalByWorkDay(interval.startTimestamp, interval.endTimestamp, rolloverHour)
                .forEach(segment => addDuration(contributions, segment.dateKey, segment.durationMs));
        });

        if (Number.isFinite(durationOverrideMs)) {
            const measuredMs = Object.values(contributions).reduce((sum, value) => sum + value, 0);
            if (measuredMs > 0) {
                const scale = Math.max(0, durationOverrideMs) / measuredMs;
                Object.keys(contributions).forEach(key => {
                    contributions[key] *= scale;
                });
            }
        }

        return contributions;
    }

    function aggregateLedger(rawLedger, activeSession = null, rolloverHour = 4, now = Date.now()) {
        const ledger = normalizeLedger(rawLedger);
        const totalsByDay = {};
        const sourcesByDay = {};
        const allSessions = ledger.sessions.filter(session => session && session.status !== 'abandoned' && session.status !== 'deleted');

        if (activeSession && activeSession.status !== 'abandoned' && !allSessions.some(session => session.id === activeSession.id)) {
            allSessions.push(activeSession);
        }

        allSessions.forEach(session => {
            const source = session.source === 'stopwatch' || session.mode === 'stopwatch' ? 'stopwatch' : 'countdown';
            const contributions = getSessionContributions(session, rolloverHour, now);
            Object.entries(contributions).forEach(([dateKey, durationMs]) => {
                addDuration(totalsByDay, dateKey, durationMs);
                if (!sourcesByDay[dateKey]) sourcesByDay[dateKey] = { countdown: 0, stopwatch: 0 };
                sourcesByDay[dateKey][source] += durationMs;
            });
        });

        ledger.adjustments.forEach(adjustment => {
            const dateKey = adjustment && adjustment.dateKey;
            const durationMs = finiteNumber(adjustment && adjustment.durationMs, 0);
            addDuration(totalsByDay, dateKey, durationMs);
            if (dateKey && durationMs !== 0) {
                if (!sourcesByDay[dateKey]) sourcesByDay[dateKey] = { countdown: 0, stopwatch: 0 };
                sourcesByDay[dateKey].countdown += durationMs;
            }
        });

        Object.keys(totalsByDay).forEach(key => {
            totalsByDay[key] = Math.max(0, totalsByDay[key]);
            if (sourcesByDay[key]) {
                sourcesByDay[key].countdown = Math.max(0, sourcesByDay[key].countdown);
                sourcesByDay[key].stopwatch = Math.max(0, sourcesByDay[key].stopwatch);
            }
        });

        return { totalsByDay, sourcesByDay };
    }

    function getSessionsForWorkDay(rawLedger, activeSession, dateKey, rolloverHour = 4, now = Date.now()) {
        const ledger = normalizeLedger(rawLedger);
        const sessions = ledger.sessions.slice();
        if (activeSession && !sessions.some(session => session.id === activeSession.id)) sessions.push(activeSession);
        return sessions
            .filter(session => session && session.status !== 'abandoned' && session.status !== 'deleted')
            .map(session => ({
                session,
                contributionMs: finiteNumber(getSessionContributions(session, rolloverHour, now)[dateKey], 0),
                totalDurationMs: getEffectiveDurationMs(session, now)
            }))
            .filter(item => item.contributionMs > 0)
            .sort((left, right) => {
                const leftTime = finiteNumber(left.session.startTimestamp, 0);
                const rightTime = finiteNumber(right.session.startTimestamp, 0);
                return rightTime - leftTime;
            });
    }

    function parseLegacyTimestamp(dateKey, timeText) {
        const date = parseDateKey(dateKey);
        const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeText || ''));
        if (!date || !match) return null;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime();
    }

    function migrateLegacyFocusData(rawFocusData, migratedAt = new Date().toISOString()) {
        const ledger = emptyLedger();
        const focusData = rawFocusData && typeof rawFocusData === 'object' ? rawFocusData : {};
        let migratedSessionCount = 0;
        let adjustmentCount = 0;

        Object.keys(focusData).sort().forEach(dateKey => {
            const day = focusData[dateKey] && typeof focusData[dateKey] === 'object' ? focusData[dateKey] : {};
            const legacySessions = Array.isArray(day.sessions) ? day.sessions : [];
            let migratedDurationMs = 0;

            legacySessions.forEach((legacySession, index) => {
                const actualMinutes = Math.max(0, finiteNumber(legacySession && legacySession.actualMinutes, 0));
                if (actualMinutes <= 0) return;

                let startTimestamp = parseLegacyTimestamp(dateKey, legacySession && legacySession.startTime);
                let endTimestamp = parseLegacyTimestamp(dateKey, legacySession && legacySession.endTime);
                if (Number.isFinite(startTimestamp) && Number.isFinite(endTimestamp) && endTimestamp < startTimestamp) {
                    const nextDay = new Date(endTimestamp);
                    nextDay.setDate(nextDay.getDate() + 1);
                    endTimestamp = nextDay.getTime();
                }

                const durationMs = actualMinutes * MINUTE_MS;
                ledger.sessions.push({
                    id: `legacy_focus_${dateKey}_${index}`,
                    source: 'countdown',
                    mode: 'countdown',
                    title: '',
                    status: 'completed',
                    completionKind: legacySession && legacySession.completed === false ? 'early' : 'planned',
                    completed: legacySession && legacySession.completed !== false,
                    plannedDurationMs: Math.max(0, finiteNumber(legacySession && legacySession.plannedMinutes, actualMinutes)) * MINUTE_MS,
                    durationOverrideMs: durationMs,
                    startTimestamp: Number.isFinite(startTimestamp) ? startTimestamp : null,
                    endTimestamp: Number.isFinite(endTimestamp) ? endTimestamp : null,
                    pauses: [],
                    precision: Number.isFinite(startTimestamp) && Number.isFinite(endTimestamp) ? 'minute' : 'duration-only',
                    legacy: true,
                    legacyDate: dateKey,
                    startTimeText: legacySession && legacySession.startTime || null,
                    endTimeText: legacySession && legacySession.endTime || null,
                    migratedAt
                });
                migratedDurationMs += durationMs;
                migratedSessionCount += 1;
            });

            const reportedDurationMs = Math.max(0, finiteNumber(day.totalMinutes, 0)) * MINUTE_MS;
            const adjustmentMs = reportedDurationMs - migratedDurationMs;
            if (Math.abs(adjustmentMs) >= 1) {
                ledger.adjustments.push({
                    id: `legacy_focus_adjustment_${dateKey}`,
                    dateKey,
                    durationMs: adjustmentMs,
                    reason: 'legacy-total-calibration',
                    precision: 'minute',
                    migratedAt
                });
                adjustmentCount += 1;
            }
        });

        ledger.migratedAt = migratedAt;
        ledger.migrationSummary = {
            sourceVersion: 'focusData',
            migratedSessionCount,
            adjustmentCount
        };
        return ledger;
    }

    function dateKeysEndingAt(endDateKey, count) {
        const end = parseDateKey(endDateKey) || new Date();
        const keys = [];
        const total = Math.max(0, Math.trunc(finiteNumber(count, 0)));
        for (let index = total - 1; index >= 0; index -= 1) {
            const date = new Date(end.getFullYear(), end.getMonth(), end.getDate() - index);
            keys.push(formatDateKey(date));
        }
        return keys;
    }

    function formatLegacyTime(timestamp, fallback) {
        const numericTimestamp = finiteNumber(timestamp, NaN);
        if (!Number.isFinite(numericTimestamp)) return fallback || null;
        const date = new Date(numericTimestamp);
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    function buildCompatibilityFocusData(rawLedger, rolloverHour = 4) {
        const ledger = normalizeLedger(rawLedger);
        const aggregate = aggregateLedger(ledger, null, rolloverHour, Date.now());
        const compatibilityData = {};

        Object.entries(aggregate.totalsByDay).forEach(([dateKey, durationMs]) => {
            compatibilityData[dateKey] = {
                totalMinutes: Math.round((durationMs / MINUTE_MS) * 1000) / 1000,
                sessions: []
            };
        });

        ledger.sessions.forEach(session => {
            if (!session || session.status === 'abandoned' || session.status === 'deleted') return;
            const dateKey = session.legacyDate || (Number.isFinite(finiteNumber(session.startTimestamp, NaN))
                ? workDayKey(session.startTimestamp, rolloverHour)
                : null);
            if (!dateKey) return;
            if (!compatibilityData[dateKey]) compatibilityData[dateKey] = { totalMinutes: 0, sessions: [] };
            compatibilityData[dateKey].sessions.push({
                id: session.id,
                plannedMinutes: Math.round(finiteNumber(session.plannedDurationMs, 0) / MINUTE_MS),
                actualMinutes: Math.round((getEffectiveDurationMs(session) / MINUTE_MS) * 1000) / 1000,
                completed: session.completionKind !== 'early',
                startTime: formatLegacyTime(session.startTimestamp, session.startTimeText),
                endTime: formatLegacyTime(session.endTimestamp, session.endTimeText),
                source: session.source || session.mode || 'countdown'
            });
        });

        return compatibilityData;
    }

    return {
        MINUTE_MS,
        HOUR_MS,
        DAY_MS,
        formatDateKey,
        parseDateKey,
        workDayKey,
        workDayBounds,
        emptyLedger,
        normalizeLedger,
        getEffectiveIntervals,
        getEffectiveDurationMs,
        splitIntervalByWorkDay,
        getSessionContributions,
        aggregateLedger,
        getSessionsForWorkDay,
        migrateLegacyFocusData,
        dateKeysEndingAt,
        buildCompatibilityFocusData
    };
});
