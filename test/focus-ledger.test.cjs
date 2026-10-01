const test = require('node:test');
const assert = require('node:assert/strict');
const Ledger = require('../assets/focus-ledger.js');

function localTimestamp(year, month, day, hour, minute = 0) {
    return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

test('凌晨四点前归入上一工作日，四点整翻页', () => {
    assert.equal(Ledger.workDayKey(localTimestamp(2026, 9, 3, 3, 59), 4), '2026-09-02');
    assert.equal(Ledger.workDayKey(localTimestamp(2026, 9, 3, 4, 0), 4), '2026-09-03');
});

test('日期键拒绝被 JavaScript 自动滚动到下月的无效日期', () => {
    assert.equal(Ledger.parseDateKey('2026-02-29'), null);
    assert.equal(Ledger.parseDateKey('2026-13-01'), null);
    assert.equal(Ledger.formatDateKey(Ledger.parseDateKey('2028-02-29')), '2028-02-29');
});

test('跨工作日边界按实际区间拆分', () => {
    const start = localTimestamp(2026, 9, 3, 3, 30);
    const end = localTimestamp(2026, 9, 3, 4, 30);
    const segments = Ledger.splitIntervalByWorkDay(start, end, 4);
    assert.deepEqual(segments.map(segment => [segment.dateKey, segment.durationMs]), [
        ['2026-09-02', 30 * Ledger.MINUTE_MS],
        ['2026-09-03', 30 * Ledger.MINUTE_MS]
    ]);
});

test('暂停区间从有效时长和跨日汇总中排除', () => {
    const session = {
        source: 'stopwatch',
        startTimestamp: localTimestamp(2026, 9, 3, 3, 30),
        endTimestamp: localTimestamp(2026, 9, 3, 5, 0),
        pauses: [{
            startTimestamp: localTimestamp(2026, 9, 3, 3, 45),
            endTimestamp: localTimestamp(2026, 9, 3, 4, 15)
        }]
    };
    assert.equal(Ledger.getEffectiveDurationMs(session), 60 * Ledger.MINUTE_MS);
    assert.deepEqual(Ledger.getSessionContributions(session, 4), {
        '2026-09-02': 15 * Ledger.MINUTE_MS,
        '2026-09-03': 45 * Ledger.MINUTE_MS
    });
});

test('运行中会话按时间戳继续累计，暂停中的会话保持不变', () => {
    const start = localTimestamp(2026, 9, 3, 9, 0);
    const now = localTimestamp(2026, 9, 3, 12, 0);
    assert.equal(Ledger.getEffectiveDurationMs({ startTimestamp: start, pauses: [] }, now), 3 * Ledger.HOUR_MS);
    assert.equal(Ledger.getEffectiveDurationMs({
        startTimestamp: start,
        pauses: [{ startTimestamp: localTimestamp(2026, 9, 3, 10, 0), endTimestamp: null }]
    }, now), Ledger.HOUR_MS);
});

test('旧 focusData 迁移保留分钟精度并用校准量对齐旧总数', () => {
    const ledger = Ledger.migrateLegacyFocusData({
        '2026-09-01': {
            totalMinutes: 70,
            sessions: [{
                id: 'old',
                plannedMinutes: 25,
                actualMinutes: 25,
                completed: true,
                startTime: '09:00',
                endTime: '09:25'
            }]
        }
    }, '2026-09-03T00:00:00.000Z');

    assert.equal(ledger.sessions.length, 1);
    assert.equal(ledger.sessions[0].precision, 'minute');
    assert.equal(ledger.sessions[0].legacy, true);
    assert.equal(ledger.adjustments.length, 1);
    assert.equal(ledger.adjustments[0].durationMs, 45 * Ledger.MINUTE_MS);
    const aggregate = Ledger.aggregateLedger(ledger);
    assert.equal(aggregate.totalsByDay['2026-09-01'], 70 * Ledger.MINUTE_MS);
    assert.equal(aggregate.sourcesByDay['2026-09-01'].countdown, 70 * Ledger.MINUTE_MS);
});

test('统一汇总区分倒计时与正计时，并计入运行中会话', () => {
    const now = localTimestamp(2026, 9, 3, 11, 0);
    const ledger = {
        version: 1,
        sessions: [{
            id: 'countdown',
            source: 'countdown',
            status: 'completed',
            startTimestamp: localTimestamp(2026, 9, 3, 9, 0),
            endTimestamp: localTimestamp(2026, 9, 3, 10, 0),
            pauses: []
        }],
        adjustments: []
    };
    const active = {
        id: 'stopwatch',
        source: 'stopwatch',
        status: 'running',
        startTimestamp: localTimestamp(2026, 9, 3, 10, 30),
        endTimestamp: null,
        durationOverrideMs: null,
        pauses: []
    };
    const aggregate = Ledger.aggregateLedger(ledger, active, 4, now);
    assert.equal(aggregate.totalsByDay['2026-09-03'], 90 * Ledger.MINUTE_MS);
    assert.equal(aggregate.sourcesByDay['2026-09-03'].countdown, 60 * Ledger.MINUTE_MS);
    assert.equal(aggregate.sourcesByDay['2026-09-03'].stopwatch, 30 * Ledger.MINUTE_MS);
});

test('人工有效时长覆盖值在跨日时按墙钟区间比例分摊', () => {
    const session = {
        source: 'stopwatch',
        startTimestamp: localTimestamp(2026, 9, 3, 3, 0),
        endTimestamp: localTimestamp(2026, 9, 3, 5, 0),
        durationOverrideMs: Ledger.HOUR_MS,
        pauses: []
    };
    assert.deepEqual(Ledger.getSessionContributions(session, 4), {
        '2026-09-02': 30 * Ledger.MINUTE_MS,
        '2026-09-03': 30 * Ledger.MINUTE_MS
    });
});
