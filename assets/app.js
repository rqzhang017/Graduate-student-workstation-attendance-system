        // 全局变量
        let checkinData = {}; // 打卡数据
        let phoneResistData = { totalCount: 0, records: {} }; // 手机克制数据
        let taskData = {}; // 任务数据
        let leaveData = []; // 请假数据
        let achievements = []; // 成就数据
        let currentTask = null; // 当前进行中的任务
        let rulesConfig = null; // 打卡规则配置
        let focusData = {}; // 专注记录
        let currentFocusSession = null; // 当前专注会话
        let restData = {}; // 休息记录
        let currentRestSession = null; // 当前休息会话
        let sedentaryData = {}; // 久坐提醒记录
        let currentSedentarySession = null; // 当前久坐提醒会话
        let catData = { affection: 0, fedRecords: {} }; // 猫咪互动数据
        let dayRolloverHour = 4; // 工作日翻页时刻（凌晨N点前算前一天）
        let taskTimer = null; // 任务计时器
        let taskStartTime = null; // 任务开始时间
        let focusTimer = null; // 专注计时器
        let restTimer = null; // 休息计时器
        let sedentaryTimer = null; // 久坐提醒计时器
        let catMessageTimer = null; // 猫咪临时台词计时器
        let catTemporaryMessage = ''; // 猫咪临时台词
        let focusReminderAudioContext = null; // 专注完成声音提醒
        let focusReminderSoundTimer = null; // 专注完成声音循环
        let focusTitleTimer = null; // 专注完成标题闪烁
        let restTitleTimer = null; // 休息结束标题闪烁
        let focusOriginalTitle = ''; // 原始页面标题
        let pendingFocusCompletionReminderId = null; // 等待用户确认的桌面专注提醒
        let pendingRestCompletionReminderId = null; // 等待用户确认的桌面休息提醒
        let lastRenderedNaturalDate = null; // 最近一次渲染的自然日
        let lastRenderedWorkDay = null; // 最近一次渲染的工作日
        let lastRenderedMinuteKey = null; // 最近一次渲染的分钟
        let deferredStorageSnapshot = null; // 等待空闲写入的兼容存储快照
        let deferredStorageTimer = null; // 兼容存储延迟写入计时器
        let chartJsLoadPromise = null; // Chart.js 懒加载 Promise
        let statsDataCache = {}; // 统计数据缓存
        let statsDataDirty = true; // 统计缓存失效标记
        const domCache = new Map();
        const tickHandlers = new Map();
        let appTickTimer = null;

        const SEDENTARY_SIT_MINUTES = 45;
        const SEDENTARY_STAND_MINUTES = 5;
        const CHECKIN_REMINDER_LEAD_MINUTES = 10;
        const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js';
        const NAV_SECTION_IDS = ['checkin-section', 'phone-section', 'tasks-section', 'focus-section', 'rest-section', 'sedentary-section', 'leave-section', 'stats-section', 'rules-section'];
        const NAV_BUTTON_IDS = ['nav-checkin', 'nav-phone', 'nav-tasks', 'nav-focus', 'nav-rest', 'nav-sedentary', 'nav-leave', 'nav-stats', 'nav-rules'];
        
        const STORAGE_KEYS = {
            appState: 'phdWorkstationAppState',
            appStateBackup: 'phdWorkstationAppStateBackup',
            checkinData: 'checkinData',
            phoneResistData: 'phoneResistData',
            taskData: 'taskData',
            leaveData: 'leaveData',
            achievements: 'achievements',
            currentTask: 'currentTask',
            rulesConfig: 'rulesConfig',
            focusData: 'focusData',
            currentFocusSession: 'currentFocusSession',
            restData: 'restData',
            currentRestSession: 'currentRestSession',
            sedentaryData: 'sedentaryData',
            currentSedentarySession: 'currentSedentarySession',
            catData: 'catData',
            dayRolloverHour: 'dayRolloverHour'
        };

        const PERIOD_LABELS = {
            morning: '上午',
            afternoon: '下午',
            evening: '晚上'
        };

        const ACTION_LABELS = {
            checkIn: '上班',
            checkOut: '下班'
        };

        const CHECKIN_PERIODS = ['morning', 'afternoon', 'evening'];
        const CHECKIN_ACTIONS = ['checkIn', 'checkOut'];

        function getElement(id) {
            if (!domCache.has(id)) {
                domCache.set(id, document.getElementById(id));
            }
            return domCache.get(id);
        }

        function setTickHandler(name, handler) {
            if (handler) {
                tickHandlers.set(name, handler);
            } else {
                tickHandlers.delete(name);
            }

            if (tickHandlers.size > 0 && !appTickTimer) {
                appTickTimer = setInterval(() => {
                    tickHandlers.forEach(tickHandler => tickHandler());
                }, 1000);
            } else if (tickHandlers.size === 0 && appTickTimer) {
                clearInterval(appTickTimer);
                appTickTimer = null;
            }
        }

        function isSectionVisible(sectionId) {
            const section = getElement(sectionId);
            return section && !section.classList.contains('hidden');
        }

        function getDesktopBridge() {
            return window.attendanceDesktop && window.attendanceDesktop.isAvailable
                ? window.attendanceDesktop
                : null;
        }

        function setButtonState(button, enabled) {
            if (!button) return;

            const nextState = enabled ? 'enabled' : 'disabled';
            const shouldDisable = !enabled;

            if (button.disabled === shouldDisable && button.dataset.state === nextState) {
                return;
            }

            button.disabled = shouldDisable;
            button.dataset.state = nextState;

            if (enabled) {
                button.classList.add('bg-primary', 'hover:bg-primary/90', 'text-white', 'btn-shadow');
                button.classList.remove('bg-gray-200', 'text-gray-500');
            } else {
                button.classList.add('bg-gray-200', 'text-gray-500');
                button.classList.remove('bg-primary', 'hover:bg-primary/90', 'text-white', 'btn-shadow');
            }
        }
        
        // 成就列表
        const achievementList = [
            { id: 'first_resist', name: '初次克制', description: '第一次忍住玩手机', requirement: 1 },
            { id: 'small_achievement', name: '小有成就', description: '忍住玩手机10次', requirement: 10 },
            { id: 'strong_will', name: '意志坚强', description: '忍住玩手机50次', requirement: 50 },
            { id: 'phone_killer', name: '手机克星', description: '忍住玩手机100次', requirement: 100 },
            { id: 'focus_master', name: '专注大师', description: '忍住玩手机365次', requirement: 365 },
            { id: 'first_checkin', name: '初次打卡', description: '第一次完成打卡', requirement: 1, type: 'checkin' },
            { id: 'week_streak', name: '一周坚持', description: '连续打卡7天', requirement: 7, type: 'streak' },
            { id: 'month_streak', name: '月度达人', description: '连续打卡30天', requirement: 30, type: 'streak' },
            { id: 'task_master', name: '任务大师', description: '完成100个任务', requirement: 100, type: 'task' },
            { id: 'time_master', name: '时间大师', description: '累计任务时间达到1000小时', requirement: 1000, type: 'task_hour' }
        ];
        
        // DOM 加载完成后执行
        document.addEventListener('DOMContentLoaded', function() {
            focusOriginalTitle = document.title;

            // 初始化数据
            initData();

            // 初始化规则展示与设置
            applyRulesToCheckinCard();
            initRuleSettings();
            
            // 更新当前日期时间
            updateDateTime();
            scheduleDateTimeUpdates();
            
            // 初始化导航切换
            initNavigation();
            
            // 初始化打卡功能
            initCheckin();
            
            // 初始化手机克制功能
            initPhoneResist();
            
            // 初始化任务管理功能
            initTaskManagement();

            // 初始化专注时长功能
            initFocusManagement();

            // 初始化休息计时功能
            initRestManagement();

            // 初始化久坐提醒功能
            initSedentaryReminder();

            // 初始化猫咪陪伴功能
            initCatCompanion();
            
            // 初始化请假功能
            initLeaveManagement();
            
            // 初始化统计分析功能
            initStatistics();
            
            // 更新今日状态
            updateTodayStatus();
        });

        window.addEventListener('beforeunload', function() {
            flushDeferredStorage();
        });

        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'hidden') {
                flushDeferredStorage();
            }
        });
        
        function safeParseJSON(rawValue, fallbackValue) {
            if (!rawValue) return fallbackValue;
            
            try {
                return JSON.parse(rawValue);
            } catch (error) {
                console.warn('本地数据解析失败，已使用默认值。', error);
                return fallbackValue;
            }
        }

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
        
        function formatLocalDate(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
        
        function parseStoredDate(dateString) {
            if (!dateString) return null;
            
            const parts = dateString.split('-').map(Number);
            if (parts.length !== 3 || parts.some(Number.isNaN)) {
                return null;
            }
            
            return new Date(parts[0], parts[1] - 1, parts[2]);
        }

        function createDefaultRulesConfig() {
            return {
                morning: {
                    checkIn: {
                        allowed: { start: '06:00', end: '12:00' },
                        qualified: { start: '06:00', end: '08:00' }
                    },
                    checkOut: {
                        allowed: { start: '09:00', end: '14:00' },
                        qualified: { start: '09:00', end: '12:00' }
                    }
                },
                afternoon: {
                    checkIn: {
                        allowed: { start: '12:00', end: '17:00' },
                        qualified: { start: '12:00', end: '14:00' }
                    },
                    checkOut: {
                        allowed: { start: '14:00', end: '20:00' },
                        qualified: { start: '14:00', end: '18:00' }
                    }
                },
                evening: {
                    checkIn: {
                        allowed: { start: '17:00', end: '22:00' },
                        qualified: { start: '17:00', end: '19:00' }
                    },
                    checkOut: {
                        allowed: { start: '20:00', end: '24:00' },
                        qualified: { start: '21:00', end: '22:00' }
                    }
                }
            };
        }

        function normalizeTimeValue(timeValue) {
            if (!timeValue) return '00:00';
            const parts = timeValue.split(':');
            if (parts.length < 2) return '00:00';
            const hour = String(Math.min(Math.max(parseInt(parts[0], 10) || 0, 0), 47)).padStart(2, '0');
            const minute = String(Math.min(Math.max(parseInt(parts[1], 10) || 0, 0), 59)).padStart(2, '0');
            return `${hour}:${minute}`;
        }

        function minutesToTimeString(totalMinutes) {
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }

        function toTimeInputValue(timeValue) {
            const normalized = normalizeTimeValue(timeValue);
            return timeToMinutes(normalized) >= 1440 ? '23:59' : normalized;
        }

        function normalizeRulesConfig(config) {
            const defaultConfig = createDefaultRulesConfig();
            const normalized = JSON.parse(JSON.stringify(defaultConfig));

            ['morning', 'afternoon', 'evening'].forEach(period => {
                ['checkIn', 'checkOut'].forEach(action => {
                    const source = config?.[period]?.[action] || {};
                    normalized[period][action].allowed.start = normalizeTimeValue(source.allowed?.start || normalized[period][action].allowed.start);
                    normalized[period][action].allowed.end = normalizeTimeValue(source.allowed?.end || normalized[period][action].allowed.end);
                    normalized[period][action].qualified.start = normalizeTimeValue(source.qualified?.start || normalized[period][action].qualified.start);
                    normalized[period][action].qualified.end = normalizeTimeValue(source.qualified?.end || normalized[period][action].qualified.end);
                });
            });

            return normalized;
        }

        function timeToMinutes(timeString) {
            if (!timeString) return 0;
            const [hours, minutes] = timeString.split(':').map(Number);
            return (hours * 60) + (minutes || 0);
        }

        function currentTimeToMinutes(options = {}) {
            const now = getCurrentTime();
            let minutes = (now.hour * 60) + now.minute;
            if (options.rolloverAware && now.hour < dayRolloverHour) {
                minutes += 1440;
            }
            return minutes;
        }

        function isMinuteInRange(value, start, end, inclusiveEnd = true) {
            const startMinutes = timeToMinutes(start);
            const endMinutes = timeToMinutes(end);
            if (startMinutes > endMinutes) return false;
            return inclusiveEnd
                ? value >= startMinutes && value <= endMinutes
                : value >= startMinutes && value < endMinutes;
        }

        function isTimeStringInRange(timeString, range, inclusiveEnd = true) {
            return isMinuteInRange(timeToMinutes(timeString), range.start, range.end, inclusiveEnd);
        }

        function getRule(period, action) {
            return rulesConfig[period][action];
        }

        function getEffectiveAllowedRange(period, action) {
            const rule = getRule(period, action);
            const range = { ...rule.allowed };

            if (period === 'evening' && action === 'checkOut') {
                range.end = minutesToTimeString(timeToMinutes(range.end) + dayRolloverHour * 60);
            }

            return range;
        }

        function getRecordedCheckinMinutes(period, action, timeString) {
            let minutes = timeToMinutes(timeString);

            if (period === 'evening' && action === 'checkOut' && minutes < dayRolloverHour * 60) {
                minutes += 1440;
            }

            return minutes;
        }

        function getCheckinStatusFor(period, action, timeString) {
            if (!timeString) return null;

            if (action === 'checkOut') {
                const recordedMinutes = getRecordedCheckinMinutes(period, action, timeString);
                const qualifiedRange = getRule(period, action).qualified;
                return isMinuteInRange(recordedMinutes, qualifiedRange.start, qualifiedRange.end);
            }

            return isTimeStringInRange(timeString, getRule(period, action).qualified);
        }

        function formatDisplayTime(timeString) {
            const totalMinutes = timeToMinutes(timeString);
            if (totalMinutes === 1440) {
                return '24:00';
            }
            if (totalMinutes > 1440) {
                return `次日${minutesToTimeString(totalMinutes - 1440)}`;
            }
            return normalizeTimeValue(timeString);
        }

        function formatRuleRange(range) {
            return `${formatDisplayTime(range.start)} - ${formatDisplayTime(range.end)}`;
        }

        function buildQualifiedLabel(period) {
            const checkInRange = getRule(period, 'checkIn').qualified;
            const checkOutRange = getRule(period, 'checkOut').qualified;
            return `合格标准: ${formatRuleRange(checkInRange)}上班, ${formatRuleRange(checkOutRange)}下班`;
        }

        function applyRulesToCheckinCard() {
            ['morning', 'afternoon', 'evening'].forEach(period => {
                getElement(`${period}-checkin-window-label`).textContent = `上班时间: ${formatRuleRange(getEffectiveAllowedRange(period, 'checkIn'))}`;
                getElement(`${period}-checkout-window-label`).textContent = `下班时间: ${formatRuleRange(getEffectiveAllowedRange(period, 'checkOut'))}`;
                getElement(`${period}-qualified-label`).textContent = buildQualifiedLabel(period);
            });
        }

        function recomputeCheckinStatusForDay(dayData) {
            if (!dayData) return;

            ['morning', 'afternoon', 'evening'].forEach(period => {
                if (dayData[period].checkIn) {
                    dayData[period].status.checkIn = getCheckinStatusFor(period, 'checkIn', dayData[period].checkIn);
                } else {
                    dayData[period].status.checkIn = null;
                }

                if (dayData[period].checkOut) {
                    dayData[period].status.checkOut = getCheckinStatusFor(period, 'checkOut', dayData[period].checkOut);
                } else {
                    dayData[period].status.checkOut = null;
                }
            });
        }

        function recomputeAllCheckinStatuses() {
            Object.values(checkinData).forEach(dayData => {
                recomputeCheckinStatusForDay(dayData);
            });
        }

        function renderRulesForm() {
            ['morning', 'afternoon', 'evening'].forEach(period => {
                ['checkIn', 'checkOut'].forEach(action => {
                    const prefix = `rules-${period}-${action === 'checkIn' ? 'checkin' : 'checkout'}`;
                    const rule = getRule(period, action);
                    getElement(`${prefix}-allowed-start`).value = rule.allowed.start;
                    getElement(`${prefix}-allowed-end`).value = toTimeInputValue(rule.allowed.end);
                    getElement(`${prefix}-qualified-start`).value = rule.qualified.start;
                    getElement(`${prefix}-qualified-end`).value = toTimeInputValue(rule.qualified.end);
                });
            });
            getElement('rules-day-rollover-hour').value = dayRolloverHour;
        }

        function readRulesFromForm() {
            const updated = createDefaultRulesConfig();

            ['morning', 'afternoon', 'evening'].forEach(period => {
                ['checkIn', 'checkOut'].forEach(action => {
                    const prefix = `rules-${period}-${action === 'checkIn' ? 'checkin' : 'checkout'}`;
                    updated[period][action].allowed.start = normalizeTimeValue(getElement(`${prefix}-allowed-start`).value);
                    updated[period][action].allowed.end = normalizeTimeValue(getElement(`${prefix}-allowed-end`).value);
                    updated[period][action].qualified.start = normalizeTimeValue(getElement(`${prefix}-qualified-start`).value);
                    updated[period][action].qualified.end = normalizeTimeValue(getElement(`${prefix}-qualified-end`).value);
                });
            });

            if (updated.evening.checkOut.allowed.end === '23:59') {
                updated.evening.checkOut.allowed.end = '24:00';
            }
            if (updated.evening.checkOut.qualified.end === '23:59') {
                updated.evening.checkOut.qualified.end = '24:00';
            }

            return updated;
        }

        function validateRulesConfig(config) {
            for (const period of ['morning', 'afternoon', 'evening']) {
                for (const action of ['checkIn', 'checkOut']) {
                    const rule = config[period][action];
                    const allowedStart = timeToMinutes(rule.allowed.start);
                    const allowedEnd = timeToMinutes(rule.allowed.end);
                    const qualifiedStart = timeToMinutes(rule.qualified.start);
                    const qualifiedEnd = timeToMinutes(rule.qualified.end);

                    if (allowedStart >= allowedEnd) {
                        return `${PERIOD_LABELS[period]}${ACTION_LABELS[action]}的可打卡结束时间必须晚于开始时间。`;
                    }

                    if (qualifiedStart > qualifiedEnd) {
                        return `${PERIOD_LABELS[period]}${ACTION_LABELS[action]}的合格结束时间不能早于开始时间。`;
                    }

                    if (qualifiedStart < allowedStart || qualifiedEnd > allowedEnd) {
                        return `${PERIOD_LABELS[period]}${ACTION_LABELS[action]}的合格时间必须落在可打卡时间范围内。`;
                    }
                }
            }

            return null;
        }
        
        function createDefaultCheckinDay() {
            return {
                morning: { checkIn: null, checkOut: null, status: { checkIn: null, checkOut: null } },
                afternoon: { checkIn: null, checkOut: null, status: { checkIn: null, checkOut: null } },
                evening: { checkIn: null, checkOut: null, status: { checkIn: null, checkOut: null } },
                meta: {
                    morning: { checkIn: null, checkOut: null },
                    afternoon: { checkIn: null, checkOut: null },
                    evening: { checkIn: null, checkOut: null }
                },
                leave: false,
                leaveReason: ''
            };
        }

        function normalizeCheckinDay(dayData) {
            const normalized = dayData || createDefaultCheckinDay();

            CHECKIN_PERIODS.forEach(period => {
                if (!normalized[period]) {
                    normalized[period] = { checkIn: null, checkOut: null, status: { checkIn: null, checkOut: null } };
                }
                CHECKIN_ACTIONS.forEach(action => {
                    if (!Object.prototype.hasOwnProperty.call(normalized[period], action)) {
                        normalized[period][action] = null;
                    }
                });
                if (!normalized[period].status) {
                    normalized[period].status = { checkIn: null, checkOut: null };
                }
                CHECKIN_ACTIONS.forEach(action => {
                    if (!Object.prototype.hasOwnProperty.call(normalized[period].status, action)) {
                        normalized[period].status[action] = null;
                    }
                });
            });

            if (!normalized.meta) {
                normalized.meta = {};
            }

            CHECKIN_PERIODS.forEach(period => {
                if (!normalized.meta[period]) {
                    normalized.meta[period] = {};
                }
                CHECKIN_ACTIONS.forEach(action => {
                    if (!Object.prototype.hasOwnProperty.call(normalized.meta[period], action)) {
                        normalized.meta[period][action] = null;
                    }
                });
            });

            if (typeof normalized.leave !== 'boolean') {
                normalized.leave = Boolean(normalized.leave);
            }
            if (typeof normalized.leaveReason !== 'string') {
                normalized.leaveReason = normalized.leaveReason || '';
            }

            return normalized;
        }

        function ensureCheckinDateData(date) {
            if (!checkinData[date]) {
                checkinData[date] = createDefaultCheckinDay();
            } else {
                checkinData[date] = normalizeCheckinDay(checkinData[date]);
            }

            return checkinData[date];
        }

        function ensureDateData(date) {
            ensureCheckinDateData(date);
            
            if (!phoneResistData.records[date]) {
                phoneResistData.records[date] = { count: 0, times: [] };
            }
            
            if (!taskData[date]) {
                taskData[date] = [];
            }

            if (!focusData[date]) {
                focusData[date] = { totalMinutes: 0, sessions: [] };
            } else {
                focusData[date].totalMinutes = Number(focusData[date].totalMinutes || 0);
                if (!Array.isArray(focusData[date].sessions)) focusData[date].sessions = [];
            }

            if (!restData[date]) {
                restData[date] = { totalMinutes: 0, sessions: [] };
            } else {
                restData[date].totalMinutes = Number(restData[date].totalMinutes || 0);
                if (!Array.isArray(restData[date].sessions)) restData[date].sessions = [];
            }

            if (!sedentaryData[date]) {
                sedentaryData[date] = { completedCycles: 0, totalStandMinutes: 0 };
            }
        }
        
        function loadAppState() {
            const snapshot = safeParseJSON(localStorage.getItem(STORAGE_KEYS.appState), null)
                || safeParseJSON(localStorage.getItem(STORAGE_KEYS.appStateBackup), null);
            
            if (snapshot && typeof snapshot === 'object') {
                return snapshot;
            }
            
            return {
                checkinData: safeParseJSON(localStorage.getItem(STORAGE_KEYS.checkinData), {}),
                phoneResistData: safeParseJSON(localStorage.getItem(STORAGE_KEYS.phoneResistData), { totalCount: 0, records: {} }),
                taskData: safeParseJSON(localStorage.getItem(STORAGE_KEYS.taskData), {}),
                leaveData: safeParseJSON(localStorage.getItem(STORAGE_KEYS.leaveData), []),
                achievements: safeParseJSON(localStorage.getItem(STORAGE_KEYS.achievements), []),
                currentTask: safeParseJSON(localStorage.getItem(STORAGE_KEYS.currentTask), null),
                rulesConfig: safeParseJSON(localStorage.getItem(STORAGE_KEYS.rulesConfig), createDefaultRulesConfig()),
                focusData: safeParseJSON(localStorage.getItem(STORAGE_KEYS.focusData), {}),
                currentFocusSession: safeParseJSON(localStorage.getItem(STORAGE_KEYS.currentFocusSession), null),
                restData: safeParseJSON(localStorage.getItem(STORAGE_KEYS.restData), {}),
                currentRestSession: safeParseJSON(localStorage.getItem(STORAGE_KEYS.currentRestSession), null),
                sedentaryData: safeParseJSON(localStorage.getItem(STORAGE_KEYS.sedentaryData), {}),
                currentSedentarySession: safeParseJSON(localStorage.getItem(STORAGE_KEYS.currentSedentarySession), null),
                catData: safeParseJSON(localStorage.getItem(STORAGE_KEYS.catData), { affection: 0, fedRecords: {} }),
                dayRolloverHour: safeParseJSON(localStorage.getItem(STORAGE_KEYS.dayRolloverHour), 4)
            };
        }
        
        // 初始化数据
        function initData() {
            const state = loadAppState();
            
            checkinData = state.checkinData || {};
            phoneResistData = state.phoneResistData || { totalCount: 0, records: {} };
            taskData = state.taskData || {};
            leaveData = state.leaveData || [];
            achievements = state.achievements || [];
            currentTask = state.currentTask || null;
            rulesConfig = normalizeRulesConfig(state.rulesConfig || createDefaultRulesConfig());
            focusData = state.focusData || {};
            currentFocusSession = state.currentFocusSession || null;
            restData = state.restData || {};
            currentRestSession = state.currentRestSession || null;
            sedentaryData = state.sedentaryData || {};
            currentSedentarySession = state.currentSedentarySession || null;
            catData = state.catData || { affection: 0, fedRecords: {} };
            dayRolloverHour = (typeof state.dayRolloverHour === 'number' && state.dayRolloverHour >= 0 && state.dayRolloverHour <= 8)
                ? state.dayRolloverHour : 4;

            // 确保phoneResistData格式正确
            if (!phoneResistData.records) {
                phoneResistData.records = {};
            }

            // 初始化今日数据（自然日与逻辑工作日都要确保存在）
            const today = getTodayString();
            ensureDateData(today);
            const workDay = getWorkDayString();
            if (workDay !== today) ensureDateData(workDay);
            
            if (currentTask && (!currentTask.id || !currentTask.name || !currentTask.startTimestamp)) {
                currentTask = null;
            }
            
            if (currentTask && currentTask.date) {
                ensureDateData(currentTask.date);
            }

            if (currentFocusSession && currentFocusSession.date) {
                ensureDateData(currentFocusSession.date);
            }

            if (currentRestSession && currentRestSession.date) {
                ensureDateData(currentRestSession.date);
            }

            if (currentSedentarySession && currentSedentarySession.date) {
                ensureDateData(currentSedentarySession.date);
            }

            if (!catData.fedRecords) {
                catData.fedRecords = {};
            }
            
            recomputeAllCheckinStatuses();
            
            // 保存数据
            saveData();
        }
        
        function createAppStateSnapshot() {
            return {
                version: 2,
                savedAt: new Date().toISOString(),
                checkinData,
                phoneResistData,
                taskData,
                leaveData,
                achievements,
                currentTask,
                rulesConfig,
                focusData,
                currentFocusSession,
                restData,
                currentRestSession,
                sedentaryData,
                currentSedentarySession,
                catData,
                dayRolloverHour
            };
        }

        function writeCompatibilityStorage(snapshot) {
            const serialized = JSON.stringify(snapshot);
            localStorage.setItem(STORAGE_KEYS.appStateBackup, serialized);
            localStorage.setItem(STORAGE_KEYS.checkinData, JSON.stringify(checkinData));
            localStorage.setItem(STORAGE_KEYS.phoneResistData, JSON.stringify(phoneResistData));
            localStorage.setItem(STORAGE_KEYS.taskData, JSON.stringify(taskData));
            localStorage.setItem(STORAGE_KEYS.leaveData, JSON.stringify(leaveData));
            localStorage.setItem(STORAGE_KEYS.achievements, JSON.stringify(achievements));
            localStorage.setItem(STORAGE_KEYS.currentTask, JSON.stringify(currentTask));
            localStorage.setItem(STORAGE_KEYS.rulesConfig, JSON.stringify(rulesConfig));
            localStorage.setItem(STORAGE_KEYS.focusData, JSON.stringify(focusData));
            localStorage.setItem(STORAGE_KEYS.currentFocusSession, JSON.stringify(currentFocusSession));
            localStorage.setItem(STORAGE_KEYS.restData, JSON.stringify(restData));
            localStorage.setItem(STORAGE_KEYS.currentRestSession, JSON.stringify(currentRestSession));
            localStorage.setItem(STORAGE_KEYS.sedentaryData, JSON.stringify(sedentaryData));
            localStorage.setItem(STORAGE_KEYS.currentSedentarySession, JSON.stringify(currentSedentarySession));
            localStorage.setItem(STORAGE_KEYS.catData, JSON.stringify(catData));
            localStorage.setItem(STORAGE_KEYS.dayRolloverHour, JSON.stringify(dayRolloverHour));
        }

        function scheduleCompatibilityStorageWrite(snapshot) {
            deferredStorageSnapshot = snapshot;
            if (deferredStorageTimer) return;

            const scheduleIdle = window.requestIdleCallback || function(callback) {
                return setTimeout(() => callback({ timeRemaining: () => 0 }), 300);
            };

            deferredStorageTimer = scheduleIdle(() => {
                deferredStorageTimer = null;
                flushDeferredStorage();
            }, { timeout: 1200 });
        }

        function flushDeferredStorage() {
            if (!deferredStorageSnapshot) return;

            try {
                writeCompatibilityStorage(deferredStorageSnapshot);
                deferredStorageSnapshot = null;
            } catch (error) {
                console.error('本地兼容存储失败，请检查浏览器存储空间。', error);
            }
        }

        function markStatsDirty() {
            statsDataDirty = true;
            statsDataCache = {};
        }

        // 保存数据到localStorage
        function saveData(options = {}) {
            const snapshot = createAppStateSnapshot();

            try {
                const serialized = JSON.stringify(snapshot);
                localStorage.setItem(STORAGE_KEYS.appState, serialized);
                markStatsDirty();

                if (options.flushCompatibility) {
                    deferredStorageSnapshot = snapshot;
                    flushDeferredStorage();
                } else {
                    scheduleCompatibilityStorageWrite(snapshot);
                }
            } catch (error) {
                console.error('本地存储失败，请检查浏览器存储空间。', error);
            }
        }
        
        // 更新当前日期时间
        function updateDateTime() {
            const now = new Date();
            const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' };
            const minuteKey = `${formatLocalDate(now)} ${now.getHours()}:${now.getMinutes()}`;
            if (minuteKey === lastRenderedMinuteKey) return;
            lastRenderedMinuteKey = minuteKey;

            getElement('current-date-time').textContent = now.toLocaleDateString('zh-CN', options);

            const naturalDate = getTodayString();
            const workDay = getWorkDayString();
            const shouldRefreshCheckinViews = naturalDate !== lastRenderedNaturalDate || workDay !== lastRenderedWorkDay;
            lastRenderedNaturalDate = naturalDate;
            lastRenderedWorkDay = workDay;

            // 更新打卡按钮状态
            updateCheckinButtons();

            if (shouldRefreshCheckinViews) {
                updateTodayCheckinTable();
                updateTodayStatus();
            }
        }

        function scheduleDateTimeUpdates() {
            const scheduleNext = () => {
                const now = new Date();
                const delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
                setTimeout(() => {
                    updateDateTime();
                    scheduleNext();
                }, Math.max(delay, 1000));
            };

            scheduleNext();
        }
        
        // 获取今日日期字符串 (YYYY-MM-DD)
        function getTodayString() {
            const today = new Date();
            return formatLocalDate(today);
        }

        // 获取逻辑工作日字符串：凌晨 dayRolloverHour 点前算前一天
        function getWorkDayString() {
            const now = new Date();
            if (now.getHours() < dayRolloverHour) {
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                return formatLocalDate(yesterday);
            }
            return formatLocalDate(now);
        }

        function getDateStartTimestamp(dateString) {
            const date = parseStoredDate(dateString);
            return date ? date.getTime() : Date.now();
        }

        function workDayMinutesToTimestamp(dateString, totalMinutes) {
            return getDateStartTimestamp(dateString) + totalMinutes * 60 * 1000;
        }

        // 获取当前时间字符串 (HH:MM)
        function getCurrentTimeString() {
            const now = new Date();
            return now.toTimeString().slice(0, 5);
        }
        
        // 获取当前时间对象 { hour, minute }
        function getCurrentTime() {
            const now = new Date();
            return { hour: now.getHours(), minute: now.getMinutes() };
        }
        
        // 初始化导航切换
        function initNavigation() {
            NAV_BUTTON_IDS.forEach((btnId, index) => {
                getElement(btnId).addEventListener('click', function() {
                    showSection(NAV_SECTION_IDS[index]);
                });
            });

            const desktopBridge = getDesktopBridge();
            if (desktopBridge) {
                desktopBridge.onNavigate(function(payload) {
                    if (payload && payload.sectionId) {
                        showSection(payload.sectionId);
                    }
                });
            }
        }

        function showSection(sectionId) {
            const activeIndex = NAV_SECTION_IDS.indexOf(sectionId);
            if (activeIndex === -1) return;

            NAV_SECTION_IDS.forEach(id => {
                getElement(id).classList.add('hidden');
            });

            getElement(sectionId).classList.remove('hidden');

            NAV_BUTTON_IDS.forEach(id => {
                const btn = getElement(id);
                btn.classList.remove('bg-primary', 'text-white');
                btn.classList.add('hover:bg-gray-100');
            });

            const currentBtn = getElement(NAV_BUTTON_IDS[activeIndex]);
            currentBtn.classList.add('bg-primary', 'text-white');
            currentBtn.classList.remove('hover:bg-gray-100');

            if (sectionId === 'stats-section') {
                updateSummaryStatistics();
                updateStatisticsCharts(getActiveStatsPeriod());
            } else if (sectionId === 'rules-section') {
                renderRulesForm();
            } else if (sectionId === 'rest-section') {
                updateRestTimerDisplay();
                updateTodayRestSummary();
            } else if (sectionId === 'sedentary-section') {
                updateSedentaryDisplay();
            }
        }

        function initRuleSettings() {
            renderRulesForm();

            getElement('save-rules').addEventListener('click', function() {
                const updatedRules = readRulesFromForm();
                const validationError = validateRulesConfig(updatedRules);

                if (validationError) {
                    alert(validationError);
                    return;
                }

                const newRollover = parseInt(getElement('rules-day-rollover-hour').value, 10);
                if (!isNaN(newRollover) && newRollover >= 0 && newRollover <= 8) {
                    dayRolloverHour = newRollover;
                }

                rulesConfig = normalizeRulesConfig(updatedRules);
                recomputeAllCheckinStatuses();
                applyRulesToCheckinCard();
                renderRulesForm();
                saveData();
                updateCheckinButtons();
                updateTodayCheckinTable();
                updateTodayStatus();
                updateSummaryStatistics();

                if (!getElement('stats-section').classList.contains('hidden')) {
                    updateStatisticsCharts(getActiveStatsPeriod());
                }

                getElement('rules-save-status').textContent = `规则已保存并立即生效：${new Date().toLocaleString('zh-CN')}`;
            });

            getElement('reset-rules').addEventListener('click', function() {
                rulesConfig = createDefaultRulesConfig();
                dayRolloverHour = 4;
                recomputeAllCheckinStatuses();
                applyRulesToCheckinCard();
                renderRulesForm();
                saveData();
                updateCheckinButtons();
                updateTodayCheckinTable();
                updateTodayStatus();
                updateSummaryStatistics();

                if (!getElement('stats-section').classList.contains('hidden')) {
                    updateStatisticsCharts(getActiveStatsPeriod());
                }

                getElement('rules-save-status').textContent = '已恢复默认规则并立即生效。';
            });
        }

        function initFocusManagement() {
            getElement('start-focus-session').addEventListener('click', function() {
                startFocusSession();
            });

            getElement('stop-focus-session').addEventListener('click', function() {
                stopFocusSession(false);
            });

            getElement('enable-focus-notifications').addEventListener('click', async function() {
                await requestFocusNotificationPermission();
                updateFocusNotificationStatus();
            });

            getElement('focus-completion-dismiss').addEventListener('click', function() {
                dismissFocusCompletionReminder();
                dismissRestCompletionReminder();
            });

            const desktopBridge = getDesktopBridge();
            if (desktopBridge) {
                desktopBridge.onFocusReminderDue(handleDesktopFocusReminderDue);
                desktopBridge.onFocusReminderAcknowledged(function(payload) {
                    dismissFocusCompletionReminder({ skipDesktopAck: true, sessionId: payload && payload.sessionId });
                });
            }

            document.querySelectorAll('.focus-preset').forEach(button => {
                button.addEventListener('click', function() {
                    getElement('focus-duration-input').value = this.getAttribute('data-minutes');
                });
            });

            updateFocusNotificationStatus();
            updateTodayFocusSummary();
            restoreFocusSession();
        }

        function initRestManagement() {
            getElement('start-rest-session').addEventListener('click', function() {
                startRestSession();
            });

            getElement('pause-rest-session').addEventListener('click', function() {
                pauseRestSession();
            });

            getElement('resume-rest-session').addEventListener('click', function() {
                resumeRestSession();
            });

            getElement('finish-rest-session').addEventListener('click', function() {
                finishRestSessionEarly();
            });

            getElement('reset-rest-session').addEventListener('click', function() {
                resetRestSession();
            });

            getElement('enable-rest-notifications').addEventListener('click', async function() {
                await requestRestNotificationPermission();
                updateRestNotificationStatus();
            });

            const desktopBridge = getDesktopBridge();
            if (desktopBridge) {
                if (typeof desktopBridge.onRestReminderDue === 'function') {
                    desktopBridge.onRestReminderDue(handleDesktopRestReminderDue);
                }
                if (typeof desktopBridge.onRestReminderAcknowledged === 'function') {
                    desktopBridge.onRestReminderAcknowledged(function(payload) {
                        dismissRestCompletionReminder({ skipDesktopAck: true, sessionId: payload && payload.sessionId });
                    });
                }
                if (typeof desktopBridge.onRestReminderSnooze === 'function') {
                    desktopBridge.onRestReminderSnooze(function(payload) {
                        handleDesktopRestReminderSnooze(payload);
                    });
                }
            }

            document.querySelectorAll('.rest-preset').forEach(button => {
                button.addEventListener('click', function() {
                    getElement('rest-duration-input').value = this.getAttribute('data-minutes');
                });
            });

            updateRestNotificationStatus();
            updateTodayRestSummary();
            restoreRestSession();
        }

        function initSedentaryReminder() {
            getElement('start-sedentary-session').addEventListener('click', function() {
                startSedentaryCycle();
            });

            getElement('pause-sedentary-session').addEventListener('click', function() {
                pauseSedentaryCycle();
            });

            getElement('resume-sedentary-session').addEventListener('click', function() {
                resumeSedentaryCycle();
            });

            getElement('stop-sedentary-session').addEventListener('click', function() {
                stopSedentaryCycle();
            });

            const desktopBridge = getDesktopBridge();
            if (desktopBridge) {
                desktopBridge.onSedentaryReminderDue(handleDesktopSedentaryReminderDue);
                desktopBridge.onSedentaryReminderAcknowledged(function(payload) {
                    if (payload && payload.sessionId) {
                        updateSedentaryDisplay();
                    }
                });
            }

            updateSedentaryDisplay();
            restoreSedentarySession();
        }

        function createSedentarySession(phase, cycleCount, date, startTimestamp) {
            const durationMinutes = phase === 'sit' ? SEDENTARY_SIT_MINUTES : SEDENTARY_STAND_MINUTES;
            const durationMs = durationMinutes * 60 * 1000;
            return {
                phase,
                startTimestamp,
                endTimestamp: startTimestamp + durationMs,
                isPaused: false,
                remainingMs: durationMs,
                cycleCount,
                date
            };
        }

        function getSedentaryPhaseLabel(phase) {
            if (phase === 'sit') return '坐下中';
            if (phase === 'stand') return '站立中';
            return '未开始';
        }

        function getSedentaryPhaseHint(phase, isPaused) {
            if (!phase) {
                return '点击“开始计时”后进入坐下 45 分钟的第一轮循环。';
            }
            if (phase === 'sit') {
                return isPaused ? '已暂停在坐下阶段，准备好后继续本轮 45 分钟计时。' : '继续坐下专注，满 45 分钟后会自动提醒你起身站立。';
            }
            return isPaused ? '已暂停在站立阶段，继续后完成 5 分钟站立倒计时。' : '请起身活动 5 分钟，完成后系统会自动进入下一轮坐下阶段。';
        }

        async function requestNotificationPermission() {
            if (!('Notification' in window)) return 'unsupported';
            if (Notification.permission === 'default') {
                try {
                    return await Notification.requestPermission();
                } catch (error) {
                    console.warn('浏览器通知权限请求失败。', error);
                    return Notification.permission;
                }
            }
            return Notification.permission;
        }

        function showSedentaryReminder(message) {
            if ('Notification' in window && Notification.permission === 'granted') {
                try {
                    new Notification('久坐提醒', { body: message });
                } catch (error) {
                    console.warn('浏览器通知发送失败，已退回弹窗提醒。', error);
                    alert(message);
                    return;
                }
            } else {
                alert(message);
            }
        }

        function startSedentaryCycle() {
            if (currentSedentarySession) {
                const shouldReplace = confirm('当前已有进行中的久坐提醒循环。是否停止当前循环并重新开始？');
                if (!shouldReplace) return;
                stopSedentaryCycle(false);
            }

            requestNotificationPermission();

            const today = getTodayString();
            ensureDateData(today);
            currentSedentarySession = createSedentarySession('sit', 1, today, Date.now());
            saveData();
            scheduleDesktopSedentaryReminder(currentSedentarySession);
            startSedentaryTimer();
        }

        function pauseSedentaryCycle() {
            if (!currentSedentarySession || currentSedentarySession.isPaused) return;

            const sessionId = getSedentaryDesktopReminderId(currentSedentarySession);
            currentSedentarySession.remainingMs = Math.max(currentSedentarySession.endTimestamp - Date.now(), 0);
            currentSedentarySession.isPaused = true;

            setTickHandler('sedentary', null);
            sedentaryTimer = null;
            cancelDesktopSedentaryReminder(sessionId);

            saveData();
            updateSedentaryDisplay();
        }

        function resumeSedentaryCycle() {
            if (!currentSedentarySession || !currentSedentarySession.isPaused) return;

            const now = Date.now();
            const remainingMs = Math.max(currentSedentarySession.remainingMs || 0, 1000);
            currentSedentarySession.startTimestamp = now;
            currentSedentarySession.endTimestamp = now + remainingMs;
            currentSedentarySession.isPaused = false;
            currentSedentarySession.remainingMs = remainingMs;

            saveData();
            scheduleDesktopSedentaryReminder(currentSedentarySession);
            startSedentaryTimer();
        }

        function stopSedentaryCycle(shouldConfirm = true) {
            if (!currentSedentarySession) {
                updateSedentaryDisplay();
                return;
            }

            if (shouldConfirm) {
                const confirmStop = confirm('停止后会清空当前循环，但会保留今天已经完成的轮次统计。确定停止吗？');
                if (!confirmStop) return;
            }

            setTickHandler('sedentary', null);
            sedentaryTimer = null;

            cancelDesktopSedentaryReminder(getSedentaryDesktopReminderId(currentSedentarySession));
            currentSedentarySession = null;
            saveData();
            updateSedentaryDisplay();
        }

        function restoreSedentarySession() {
            if (!currentSedentarySession) {
                updateSedentaryDisplay();
                return;
            }

            if (currentSedentarySession.date) {
                ensureDateData(currentSedentarySession.date);
            }

            if (currentSedentarySession.isPaused) {
                cancelDesktopSedentaryReminder(getSedentaryDesktopReminderId(currentSedentarySession));
                updateSedentaryDisplay();
                return;
            }

            while (currentSedentarySession && !currentSedentarySession.isPaused && Date.now() >= currentSedentarySession.endTimestamp) {
                advanceSedentaryPhase({
                    notify: false,
                    transitionTimestamp: currentSedentarySession.endTimestamp
                });
            }

            if (!currentSedentarySession) {
                updateSedentaryDisplay();
                return;
            }

            startSedentaryTimer();
            scheduleDesktopSedentaryReminder(currentSedentarySession);
        }

        function startSedentaryTimer() {
            updateSedentaryDisplay();
            sedentaryTimer = true;

            setTickHandler('sedentary', () => {
                if (!currentSedentarySession || currentSedentarySession.isPaused) return;

                if (Date.now() >= currentSedentarySession.endTimestamp) {
                    if (getDesktopBridge() && Date.now() - currentSedentarySession.endTimestamp < 15000) {
                        updateSedentaryDisplay();
                        return;
                    }
                    advanceSedentaryPhase();
                    return;
                }

                updateSedentaryDisplay();
            });
        }

        function advanceSedentaryPhase(options = {}) {
            if (!currentSedentarySession) return;

            const notify = options.notify !== false;
            const transitionTimestamp = options.transitionTimestamp || Date.now();
            const sessionDate = currentSedentarySession.date || getTodayString();
            ensureDateData(sessionDate);

            if (currentSedentarySession.phase === 'sit') {
                if (notify) {
                    showSedentaryReminder('坐下 45 分钟已完成，请现在起身活动 5 分钟。');
                }

                currentSedentarySession = createSedentarySession(
                    'stand',
                    currentSedentarySession.cycleCount || 1,
                    sessionDate,
                    transitionTimestamp
                );
            } else {
                sedentaryData[sessionDate].completedCycles += 1;
                sedentaryData[sessionDate].totalStandMinutes += SEDENTARY_STAND_MINUTES;

                if (notify) {
                    showSedentaryReminder('本轮站立 5 分钟已完成，开始下一轮坐下 45 分钟。');
                }

                currentSedentarySession = createSedentarySession(
                    'sit',
                    (currentSedentarySession.cycleCount || 1) + 1,
                    sessionDate,
                    transitionTimestamp
                );
            }

            saveData();
            updateSedentaryDisplay();

            if (currentSedentarySession && !currentSedentarySession.isPaused) {
                scheduleDesktopSedentaryReminder(currentSedentarySession);
                startSedentaryTimer();
            }
        }

        function updateSedentaryDisplay() {
            const today = getTodayString();
            ensureDateData(today);

            const countdownDisplay = getElement('sedentary-countdown-display');
            const countdownStatus = getElement('sedentary-countdown-status');
            const phaseLabel = getElement('sedentary-phase-label');
            const phaseBadge = getElement('sedentary-phase-badge');
            const cycleNumber = getElement('sedentary-cycle-number');
            const hintText = getElement('sedentary-hint-text');
            const progressBar = getElement('sedentary-progress-bar');
            const pauseButton = getElement('pause-sedentary-session');
            const resumeButton = getElement('resume-sedentary-session');
            const stopButton = getElement('stop-sedentary-session');

            getElement('sedentary-today-cycles').textContent = sedentaryData[today].completedCycles;
            getElement('sedentary-today-stand-minutes').textContent = sedentaryData[today].totalStandMinutes;

            if (!currentSedentarySession) {
                countdownDisplay.textContent = '45:00';
                countdownStatus.textContent = '当前没有进行中的久坐提醒循环';
                phaseLabel.textContent = '未开始';
                cycleNumber.textContent = '-';
                hintText.textContent = getSedentaryPhaseHint(null, false);
                progressBar.style.width = '0%';
                phaseBadge.textContent = '未开始';
                phaseBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-200 text-gray-600';
                pauseButton.classList.add('hidden');
                resumeButton.classList.add('hidden');
                stopButton.classList.add('hidden');
                return;
            }

            const durationMinutes = currentSedentarySession.phase === 'sit' ? SEDENTARY_SIT_MINUTES : SEDENTARY_STAND_MINUTES;
            const totalMs = durationMinutes * 60 * 1000;
            const remainingMs = currentSedentarySession.isPaused
                ? Math.max(currentSedentarySession.remainingMs || 0, 0)
                : Math.max(currentSedentarySession.endTimestamp - Date.now(), 0);
            const remainingSeconds = Math.ceil(remainingMs / 1000);
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            const elapsedMs = Math.max(0, totalMs - remainingMs);
            const progress = totalMs > 0 ? Math.min((elapsedMs / totalMs) * 100, 100) : 0;
            const phaseText = getSedentaryPhaseLabel(currentSedentarySession.phase);

            countdownDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            countdownStatus.textContent = currentSedentarySession.isPaused
                ? `已暂停：第 ${currentSedentarySession.cycleCount} 轮${phaseText}`
                : `进行中：第 ${currentSedentarySession.cycleCount} 轮${phaseText}`;
            phaseLabel.textContent = phaseText;
            cycleNumber.textContent = currentSedentarySession.cycleCount;
            hintText.textContent = getSedentaryPhaseHint(currentSedentarySession.phase, currentSedentarySession.isPaused);
            progressBar.style.width = `${progress}%`;

            if (currentSedentarySession.phase === 'sit') {
                phaseBadge.textContent = currentSedentarySession.isPaused ? '坐下已暂停' : '坐下中';
                phaseBadge.className = currentSedentarySession.isPaused
                    ? 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-700'
                    : 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700';
            } else {
                phaseBadge.textContent = currentSedentarySession.isPaused ? '站立已暂停' : '站立中';
                phaseBadge.className = currentSedentarySession.isPaused
                    ? 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-700'
                    : 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700';
            }

            stopButton.classList.remove('hidden');
            if (currentSedentarySession.isPaused) {
                pauseButton.classList.add('hidden');
                resumeButton.classList.remove('hidden');
            } else {
                pauseButton.classList.remove('hidden');
                resumeButton.classList.add('hidden');
            }
        }

        function initCatCompanion() {
            getElement('feed-cat-button').addEventListener('click', function() {
                feedCat();
            });

            getElement('cat-figure-button').addEventListener('click', function() {
                petCat();
            });

            updateCatCompanion();
        }

        function getTodayFedCount() {
            const today = getTodayString();
            return catData.fedRecords[today] || 0;
        }

        function getAvailableCatFood() {
            const today = getTodayString();
            ensureDateData(today);
            const totalFocusMinutes = focusData[today].totalMinutes || 0;
            const earnedFood = Math.floor(totalFocusMinutes / 60);
            return Math.max(0, earnedFood - getTodayFedCount());
        }

        function getCatMoodText(affection) {
            if (affection >= 40) return '猫咪已经非常信任你了，正在开心地蹭蹭你。';
            if (affection >= 20) return '猫咪开始对你放松下来，尾巴轻轻摇着。';
            if (affection >= 10) return '猫咪熟悉了你的气味，愿意坐在你旁边。';
            if (affection >= 1) return '猫咪记住你了，正歪头等下一口猫粮。';
            return '先专注一会儿，换猫粮来喂它吧。';
        }

        function calculateFocusStreak() {
            let streak = 0;
            const cursor = new Date();

            while (true) {
                const dateKey = formatLocalDate(cursor);
                const dayFocus = focusData[dateKey];
                if (!dayFocus || !dayFocus.totalMinutes || dayFocus.totalMinutes <= 0) {
                    break;
                }
                streak++;
                cursor.setDate(cursor.getDate() - 1);
            }

            return streak;
        }

        function getCatExpression(affection, streak) {
            if (affection >= 36 || streak >= 14) return 'adoring';
            if (affection >= 18 || streak >= 7) return 'trusting';
            if (affection >= 6 || streak >= 3) return 'happy';
            return 'curious';
        }

        function getCatDefaultMessage(affection, streak) {
            if (streak >= 14) return '连续专注两周解锁：猫咪已经把你认作最可靠的科研搭子了。';
            if (streak >= 7) return '连续专注一周解锁：猫咪每天都会准时来工位等你。';
            if (streak >= 3) return '连续专注三天解锁：猫咪愿意趴在你旁边安静陪着你。';
            return getCatMoodText(affection);
        }

        function setCatTemporaryMessage(message, duration = 2200) {
            catTemporaryMessage = message;
            clearTimeout(catMessageTimer);
            getElement('cat-mood-text').textContent = message;
            catMessageTimer = setTimeout(() => {
                catTemporaryMessage = '';
                updateCatCompanion();
            }, duration);
        }

        function animateCat(reactionClass) {
            const figure = getElement('cat-figure-button');
            figure.classList.remove('is-petted', 'is-fed');
            void figure.offsetWidth;
            figure.classList.add(reactionClass);
            setTimeout(() => {
                figure.classList.remove(reactionClass);
            }, reactionClass === 'is-fed' ? 950 : 760);
        }

        function spawnCatHearts(count = 3) {
            const burst = getElement('cat-heart-burst');
            burst.innerHTML = '';

            for (let i = 0; i < count; i++) {
                const heart = document.createElement('span');
                heart.className = 'cat-heart';
                heart.textContent = i % 3 === 0 ? '❤' : (i % 3 === 1 ? '♡' : '❤');
                heart.style.setProperty('--heart-x', `${(Math.random() * 70) - 35}px`);
                heart.style.animationDelay = `${i * 0.08}s`;
                burst.appendChild(heart);
            }

            setTimeout(() => {
                burst.innerHTML = '';
            }, 1600);
        }

        function updateCatCompanion() {
            const today = getTodayString();
            ensureDateData(today);

            const totalFocusMinutes = focusData[today].totalMinutes || 0;
            const availableFood = getAvailableCatFood();
            const fedCount = getTodayFedCount();
            const affection = catData.affection || 0;
            const focusStreak = calculateFocusStreak();
            const catExpression = getCatExpression(affection, focusStreak);

            getElement('cat-today-focus-hours').textContent = (totalFocusMinutes / 60).toFixed(totalFocusMinutes >= 60 ? 1 : 0);
            getElement('cat-food-available').textContent = availableFood;
            getElement('cat-food-fed').textContent = fedCount;
            getElement('cat-affection').textContent = affection;
            if (!catTemporaryMessage) {
                getElement('cat-mood-text').textContent = getCatDefaultMessage(affection, focusStreak);
            }
            getElement('cat-affection-bar').style.width = `${Math.min(100, affection)}%`;
            getElement('cat-food-hint').textContent = `今日已专注 ${totalFocusMinutes} 分钟，连续专注 ${focusStreak} 天。每累计 60 分钟可兑换 1 个猫粮。`;
            getElement('cat-figure-button').dataset.expression = catExpression;

            const feedButton = getElement('feed-cat-button');
            if (availableFood > 0) {
                feedButton.disabled = false;
                feedButton.textContent = '喂猫咪 1 个猫粮';
                feedButton.classList.remove('bg-gray-200', 'text-gray-700');
                feedButton.classList.add('bg-primary', 'text-white', 'btn-shadow');
            } else {
                feedButton.disabled = true;
                feedButton.textContent = '猫粮不足，先去专注';
                feedButton.classList.remove('bg-primary', 'text-white', 'btn-shadow');
                feedButton.classList.add('bg-gray-200', 'text-gray-700');
            }
        }

        function feedCat() {
            const availableFood = getAvailableCatFood();
            if (availableFood <= 0) {
                updateCatCompanion();
                return;
            }

            const today = getTodayString();
            catData.fedRecords[today] = getTodayFedCount() + 1;
            catData.affection = (catData.affection || 0) + 1;

            saveData();
            animateCat('is-fed');
            spawnCatHearts(5);
            updateCatCompanion();
            setCatTemporaryMessage('喵呜！这口猫粮很好吃，好感度又上升啦。', 2600);
        }

        function petCat() {
            const affection = catData.affection || 0;
            const focusStreak = calculateFocusStreak();
            const petMessages = [];

            if (affection >= 18) {
                petMessages.push('呼噜呼噜……猫咪把脑袋凑过来让你继续摸。');
            }
            if (focusStreak >= 7) {
                petMessages.push('猫咪眯起眼睛，像是知道你最近一直很努力。');
            }
            if (getAvailableCatFood() > 0) {
                petMessages.push('猫咪闻到了你口袋里的猫粮味道，尾巴晃得更快了。');
            }

            petMessages.push('猫咪抬头看着你，轻轻“喵”了一声。');
            petMessages.push('你摸了摸猫咪，它开心地晃了晃尾巴。');

            animateCat('is-petted');
            spawnCatHearts(2);
            setCatTemporaryMessage(petMessages[Math.floor(Math.random() * petMessages.length)], 2200);
        }

        async function requestFocusNotificationPermission() {
            return requestNotificationPermission();
        }

        function updateFocusNotificationStatus() {
            const statusElement = getElement('focus-reminder-status');
            const button = getElement('enable-focus-notifications');
            if (!statusElement || !button) return;

            if (getDesktopBridge()) {
                statusElement.textContent = '桌面版强提醒已开启：系统通知、窗口置顶、任务栏闪烁和托盘重复提醒将由 Electron 接管。';
                button.textContent = '桌面强提醒已开启';
                setButtonState(button, false);
                return;
            }

            if (!('Notification' in window)) {
                statusElement.textContent = '页面弹窗、声音和标题提醒已开启；当前浏览器不支持桌面通知。';
                button.textContent = '浏览器不支持';
                setButtonState(button, false);
                return;
            }

            if (Notification.permission === 'granted') {
                statusElement.textContent = '页面弹窗、声音、标题提醒和桌面通知均已开启。';
                button.textContent = '桌面通知已开启';
                setButtonState(button, false);
                return;
            }

            if (Notification.permission === 'denied') {
                statusElement.textContent = '页面弹窗、声音和标题提醒已开启；桌面通知已被浏览器拒绝，可在浏览器网站权限中重新允许。';
                button.textContent = '桌面通知已拒绝';
                setButtonState(button, false);
                return;
            }

            statusElement.textContent = '页面弹窗、声音和标题提醒已开启；桌面通知需要手动授权一次。';
            button.textContent = '开启桌面通知';
            setButtonState(button, true);
        }

        function getFocusAudioContext() {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return null;

            if (!focusReminderAudioContext) {
                focusReminderAudioContext = new AudioContextClass();
            }

            return focusReminderAudioContext;
        }

        function primeFocusReminderAudio() {
            const audioContext = getFocusAudioContext();
            if (!audioContext || audioContext.state !== 'suspended') return;
            audioContext.resume().catch(() => {});
        }

        function playFocusReminderTone() {
            const audioContext = getFocusAudioContext();
            if (!audioContext) return;

            if (audioContext.state === 'suspended') {
                audioContext.resume().catch(() => {});
            }

            const startTime = audioContext.currentTime;
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, startTime);
            oscillator.frequency.setValueAtTime(660, startTime + 0.22);
            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.55);

            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            oscillator.start(startTime);
            oscillator.stop(startTime + 0.58);
        }

        function startFocusReminderSound() {
            stopFocusReminderSound();
            let playCount = 0;
            const play = () => {
                if (playCount >= 5) {
                    stopFocusReminderSound();
                    return;
                }
                playFocusReminderTone();
                playCount++;
            };

            play();
            focusReminderSoundTimer = setInterval(play, 1600);
        }

        function stopFocusReminderSound() {
            if (!focusReminderSoundTimer) return;
            clearInterval(focusReminderSoundTimer);
            focusReminderSoundTimer = null;
        }

        function startFocusTitleReminder() {
            stopFocusTitleReminder();
            let showAlertTitle = true;
            document.title = '专注完成 - 请休息';
            focusTitleTimer = setInterval(() => {
                document.title = showAlertTitle ? (focusOriginalTitle || '研究生工位打卡与时间管理系统') : '专注完成 - 请休息';
                showAlertTitle = !showAlertTitle;
            }, 1000);
        }

        function stopFocusTitleReminder() {
            if (focusTitleTimer) {
                clearInterval(focusTitleTimer);
                focusTitleTimer = null;
            }
            document.title = focusOriginalTitle || '研究生工位打卡与时间管理系统';
        }

        function showFocusCompletionPopup(message) {
            getElement('focus-completion-title').textContent = '专注完成';
            getElement('focus-completion-message').textContent = message;
            getElement('focus-completion-popup').classList.remove('hidden');
        }

        function dismissFocusCompletionReminder(options = {}) {
            getElement('focus-completion-popup').classList.add('hidden');
            stopFocusReminderSound();
            stopFocusTitleReminder();
            const reminderId = options.sessionId || pendingFocusCompletionReminderId;
            if (!options.skipDesktopAck && reminderId) {
                acknowledgeDesktopFocusReminder(reminderId);
            }
            if (!options.sessionId || options.sessionId === pendingFocusCompletionReminderId) {
                pendingFocusCompletionReminderId = null;
            }
        }

        function showFocusDesktopNotification(message) {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            try {
                new Notification('专注完成', {
                    body: message,
                    requireInteraction: true
                });
            } catch (error) {
                console.warn('桌面通知发送失败，已保留页面提醒。', error);
            }
        }

        function scheduleDesktopFocusReminder(session) {
            const desktopBridge = getDesktopBridge();
            if (!desktopBridge || !session) return;

            desktopBridge.scheduleFocusReminder({
                id: session.id,
                plannedMinutes: session.plannedMinutes,
                startTimestamp: session.startTimestamp,
                endTimestamp: session.endTimestamp
            }).catch(error => {
                console.warn('桌面专注提醒调度失败，将保留网页提醒兜底。', error);
            });
        }

        function cancelDesktopFocusReminder(sessionId) {
            const desktopBridge = getDesktopBridge();
            if (!desktopBridge || !sessionId) return;

            desktopBridge.cancelFocusReminder(sessionId).catch(error => {
                console.warn('取消桌面专注提醒失败。', error);
            });
        }

        function acknowledgeDesktopFocusReminder(sessionId) {
            const desktopBridge = getDesktopBridge();
            if (!desktopBridge || !sessionId) return;

            desktopBridge.acknowledgeFocusReminder(sessionId).catch(error => {
                console.warn('确认桌面专注提醒失败。', error);
            });
        }

        function getSedentaryDesktopReminderId(session) {
            if (!session) return null;
            return `sedentary_${session.date}_${session.cycleCount}_${session.phase}_${session.endTimestamp}`;
        }

        function scheduleDesktopSedentaryReminder(session) {
            const desktopBridge = getDesktopBridge();
            if (!desktopBridge || !session) return;

            desktopBridge.scheduleSedentaryReminder({
                id: getSedentaryDesktopReminderId(session),
                phase: session.phase,
                cycleCount: session.cycleCount,
                endTimestamp: session.endTimestamp,
                isPaused: session.isPaused
            }).catch(error => {
                console.warn('桌面久坐提醒调度失败，将保留网页提醒兜底。', error);
            });
        }

        function cancelDesktopSedentaryReminder(sessionId) {
            const desktopBridge = getDesktopBridge();
            if (!desktopBridge || !sessionId) return;

            desktopBridge.cancelSedentaryReminder(sessionId).catch(error => {
                console.warn('取消桌面久坐提醒失败。', error);
            });
        }

        function acknowledgeDesktopSedentaryReminder(sessionId) {
            const desktopBridge = getDesktopBridge();
            if (!desktopBridge || !sessionId) return;

            desktopBridge.acknowledgeSedentaryReminder(sessionId).catch(error => {
                console.warn('确认桌面久坐提醒失败。', error);
            });
        }

        function handleDesktopSedentaryReminderDue(payload) {
            if (!currentSedentarySession) return;
            const sessionId = getSedentaryDesktopReminderId(currentSedentarySession);
            if (payload && payload.sessionId && payload.sessionId !== sessionId) return;
            advanceSedentaryPhase({ notify: false, source: 'desktop' });
        }

        function handleDesktopFocusReminderDue(payload) {
            if (!currentFocusSession) return;
            if (payload && payload.sessionId && payload.sessionId !== currentFocusSession.id) return;
            completeFocusSession('desktop');
        }

        function startFocusSession() {
            const minutes = parseInt(getElement('focus-duration-input').value, 10);
            if (!Number.isFinite(minutes) || minutes <= 0) {
                alert('请输入大于 0 的专注分钟数。');
                return;
            }

            if (currentFocusSession) {
                const shouldReplace = confirm('当前已有进行中的专注计时。是否结束当前计时并开始新的专注？');
                if (!shouldReplace) return;
                stopFocusSession(false);
            }

            dismissFocusCompletionReminder();
            primeFocusReminderAudio();

            const today = getTodayString();
            ensureDateData(today);

            currentFocusSession = {
                id: `focus_${Date.now()}`,
                date: today,
                plannedMinutes: minutes,
                startTimestamp: Date.now(),
                endTimestamp: Date.now() + minutes * 60 * 1000
            };

            saveData();
            scheduleDesktopFocusReminder(currentFocusSession);
            startFocusTimer();
            updateTodayStatus();
        }

        function restoreFocusSession() {
            if (!currentFocusSession || !currentFocusSession.endTimestamp) {
                updateFocusTimerDisplay();
                return;
            }

            if (Date.now() >= currentFocusSession.endTimestamp) {
                completeFocusSession();
                return;
            }

            startFocusTimer();
            scheduleDesktopFocusReminder(currentFocusSession);
        }

        function startFocusTimer() {
            getElement('stop-focus-session').classList.remove('hidden');
            updateFocusTimerDisplay();
            focusTimer = true;

            setTickHandler('focus', () => {
                if (!currentFocusSession) return;

                if (Date.now() >= currentFocusSession.endTimestamp) {
                    if (getDesktopBridge() && Date.now() - currentFocusSession.endTimestamp < 15000) {
                        updateFocusTimerDisplay();
                        return;
                    }
                    completeFocusSession();
                    return;
                }

                updateFocusTimerDisplay();
            });
        }

        function updateFocusTimerDisplay() {
            const countdownDisplay = getElement('focus-countdown-display');
            const focusStatus = getElement('focus-session-status');
            const progressBar = getElement('focus-progress-bar');
            const stopButton = getElement('stop-focus-session');

            if (!currentFocusSession) {
                countdownDisplay.textContent = '00:00';
                focusStatus.textContent = '当前没有进行中的专注计时';
                progressBar.style.width = '0%';
                stopButton.classList.add('hidden');
                return;
            }

            const remainingMs = Math.max(currentFocusSession.endTimestamp - Date.now(), 0);
            const remainingSeconds = Math.ceil(remainingMs / 1000);
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            countdownDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

            const totalMs = currentFocusSession.plannedMinutes * 60 * 1000;
            const elapsedMs = Math.min(Date.now() - currentFocusSession.startTimestamp, totalMs);
            const progress = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
            progressBar.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
            focusStatus.textContent = `进行中：本次目标 ${currentFocusSession.plannedMinutes} 分钟`;
            stopButton.classList.remove('hidden');
        }

        function finalizeFocusSession(completed) {
            if (!currentFocusSession) return null;

            const session = currentFocusSession;
            const recordedDate = session.date || getTodayString();
            ensureDateData(recordedDate);

            const endTimestamp = completed ? session.endTimestamp : Date.now();
            const elapsedMinutes = Math.max(1, Math.round((endTimestamp - session.startTimestamp) / (1000 * 60)));
            const actualMinutes = completed ? session.plannedMinutes : Math.min(elapsedMinutes, session.plannedMinutes);

            focusData[recordedDate].totalMinutes += actualMinutes;
            focusData[recordedDate].sessions.push({
                id: session.id,
                plannedMinutes: session.plannedMinutes,
                actualMinutes,
                completed,
                startTime: new Date(session.startTimestamp).toTimeString().slice(0, 5),
                endTime: new Date(endTimestamp).toTimeString().slice(0, 5)
            });

            currentFocusSession = null;
            setTickHandler('focus', null);
            focusTimer = null;

            saveData();
            updateFocusTimerDisplay();
            updateTodayFocusSummary();
            updateCatCompanion();
            updateTodayStatus();
            updateSummaryStatistics();

            if (!getElement('stats-section').classList.contains('hidden')) {
                updateStatisticsCharts(getActiveStatsPeriod());
            }

            return session;
        }

        function showFocusReminder(session) {
            const message = '本次专注计时已完成，请休息一下。';
            pendingFocusCompletionReminderId = session && session.id ? session.id : null;
            showFocusCompletionPopup(message);
            startFocusReminderSound();
            startFocusTitleReminder();
            if (!getDesktopBridge()) {
                showFocusDesktopNotification(message);
            }
            updateFocusNotificationStatus();
        }

        function completeFocusSession(source = 'web') {
            const session = finalizeFocusSession(true);
            if (!session) return;
            showFocusReminder(session);
            if (source !== 'desktop' && !getDesktopBridge()) {
                pendingFocusCompletionReminderId = null;
            }
        }

        function stopFocusSession(isCompleted = false) {
            const session = finalizeFocusSession(isCompleted);
            if (!session) return;
            cancelDesktopFocusReminder(session.id);
            if (isCompleted) {
                showFocusReminder(session);
            }
        }

        function updateTodayFocusSummary() {
            const today = getTodayString();
            ensureDateData(today);

            const todayFocus = focusData[today];
            getElement('focus-today-total').textContent = todayFocus.totalMinutes;
            getElement('focus-today-count').textContent = todayFocus.sessions.length;

            const container = getElement('focus-today-records');
            if (todayFocus.sessions.length === 0) {
                container.innerHTML = '<div class="text-gray-500">暂无专注记录</div>';
                return;
            }

            container.innerHTML = '';
            [...todayFocus.sessions].reverse().forEach(session => {
                const row = document.createElement('div');
                row.className = 'bg-white rounded-lg p-3 flex items-center justify-between';
                row.innerHTML = `
                    <div>
                        <div class="font-medium text-gray-800">${session.startTime} - ${session.endTime}</div>
                        <div class="text-xs text-gray-500">${session.completed ? '已完成' : '提前结束'}，计划 ${session.plannedMinutes} 分钟</div>
                    </div>
                    <div class="text-primary font-semibold">${session.actualMinutes} 分钟</div>
                `;
                container.appendChild(row);
            });
        }

        async function requestRestNotificationPermission() {
            return requestNotificationPermission();
        }

        function updateRestNotificationStatus() {
            const statusElement = getElement('rest-reminder-status');
            const button = getElement('enable-rest-notifications');
            if (!statusElement || !button) return;

            if (getDesktopBridge()) {
                statusElement.textContent = '桌面版强提醒已开启：休息结束后会由 Electron 触发系统通知、窗口置顶、任务栏闪烁和托盘提醒。';
                button.textContent = '桌面强提醒已开启';
                setButtonState(button, false);
                return;
            }

            if (!('Notification' in window)) {
                statusElement.textContent = '页面弹窗、声音和标题提醒已开启；当前浏览器不支持桌面通知。';
                button.textContent = '浏览器不支持';
                setButtonState(button, false);
                return;
            }

            if (Notification.permission === 'granted') {
                statusElement.textContent = '页面弹窗、声音、标题提醒和桌面通知均已开启。';
                button.textContent = '桌面通知已开启';
                setButtonState(button, false);
                return;
            }

            if (Notification.permission === 'denied') {
                statusElement.textContent = '页面弹窗、声音和标题提醒已开启；桌面通知已被浏览器拒绝，可在浏览器网站权限中重新允许。';
                button.textContent = '桌面通知已拒绝';
                setButtonState(button, false);
                return;
            }

            statusElement.textContent = '页面弹窗、声音和标题提醒已开启；桌面通知需要手动授权一次。';
            button.textContent = '开启桌面通知';
            setButtonState(button, true);
        }

        function createRestSession(minutes, date, startTimestamp) {
            const durationMs = minutes * 60 * 1000;
            return {
                id: `rest_${Date.now()}`,
                date,
                plannedMinutes: minutes,
                originalStartTimestamp: startTimestamp,
                startTimestamp,
                endTimestamp: startTimestamp + durationMs,
                isPaused: false,
                remainingMs: durationMs,
                elapsedMs: 0
            };
        }

        function getRestElapsedMs(session) {
            if (!session) return 0;
            const totalMs = session.plannedMinutes * 60 * 1000;
            const baseElapsedMs = Math.max(session.elapsedMs || 0, 0);
            if (session.isPaused) {
                return Math.min(baseElapsedMs, totalMs);
            }
            return Math.min(baseElapsedMs + Math.max(Date.now() - session.startTimestamp, 0), totalMs);
        }

        function getRestRemainingMs(session) {
            if (!session) return 0;
            if (session.isPaused) {
                return Math.max(session.remainingMs || 0, 0);
            }
            return Math.max(session.endTimestamp - Date.now(), 0);
        }

        function startRestSession(minutesOverride = null, options = {}) {
            const minutes = Number.isFinite(minutesOverride)
                ? minutesOverride
                : parseInt(getElement('rest-duration-input').value, 10);

            if (!Number.isFinite(minutes) || minutes <= 0) {
                alert('请输入大于 0 的休息分钟数。');
                return;
            }

            if (minutes > 240) {
                alert('单次休息时长最多 240 分钟。');
                return;
            }

            if (currentRestSession) {
                const shouldReplace = options.force || confirm('当前已有进行中的休息计时。是否重置当前计时并开始新的休息？');
                if (!shouldReplace) return;
                resetRestSession(false);
            }

            dismissRestCompletionReminder();
            primeFocusReminderAudio();

            const today = getTodayString();
            ensureDateData(today);
            currentRestSession = createRestSession(minutes, today, Date.now());

            saveData();
            scheduleDesktopRestReminder(currentRestSession);
            startRestTimer();
        }

        function pauseRestSession() {
            if (!currentRestSession || currentRestSession.isPaused) return;

            const sessionId = currentRestSession.id;
            currentRestSession.remainingMs = getRestRemainingMs(currentRestSession);
            currentRestSession.elapsedMs = getRestElapsedMs(currentRestSession);
            currentRestSession.isPaused = true;

            setTickHandler('rest', null);
            restTimer = null;
            cancelDesktopRestReminder(sessionId);

            saveData();
            updateRestTimerDisplay();
        }

        function resumeRestSession() {
            if (!currentRestSession || !currentRestSession.isPaused) return;

            const now = Date.now();
            const remainingMs = Math.max(currentRestSession.remainingMs || 0, 1000);
            currentRestSession.startTimestamp = now;
            currentRestSession.endTimestamp = now + remainingMs;
            currentRestSession.isPaused = false;
            currentRestSession.remainingMs = remainingMs;

            saveData();
            scheduleDesktopRestReminder(currentRestSession);
            startRestTimer();
        }

        function finishRestSessionEarly() {
            if (!currentRestSession) return;
            const shouldFinish = confirm('提前结束会按已经休息的实际时长写入今日记录。确定结束吗？');
            if (!shouldFinish) return;
            stopRestSession(false);
        }

        function resetRestSession(shouldConfirm = true) {
            if (!currentRestSession) {
                updateRestTimerDisplay();
                return;
            }

            if (shouldConfirm) {
                const confirmReset = confirm('重置后会清空当前休息计时，不会写入今日休息记录。确定重置吗？');
                if (!confirmReset) return;
            }

            const sessionId = currentRestSession.id;
            setTickHandler('rest', null);
            restTimer = null;
            cancelDesktopRestReminder(sessionId);
            currentRestSession = null;

            saveData();
            updateRestTimerDisplay();
        }

        function restoreRestSession() {
            if (!currentRestSession || !currentRestSession.endTimestamp) {
                updateRestTimerDisplay();
                return;
            }

            if (currentRestSession.date) {
                ensureDateData(currentRestSession.date);
            }

            if (currentRestSession.isPaused) {
                cancelDesktopRestReminder(currentRestSession.id);
                updateRestTimerDisplay();
                return;
            }

            if (Date.now() >= currentRestSession.endTimestamp) {
                completeRestSession();
                return;
            }

            startRestTimer();
            scheduleDesktopRestReminder(currentRestSession);
        }

        function startRestTimer() {
            updateRestTimerDisplay();
            restTimer = true;

            setTickHandler('rest', () => {
                if (!currentRestSession || currentRestSession.isPaused) return;

                if (Date.now() >= currentRestSession.endTimestamp) {
                    if (getDesktopBridge() && Date.now() - currentRestSession.endTimestamp < 15000) {
                        updateRestTimerDisplay();
                        return;
                    }
                    completeRestSession();
                    return;
                }

                updateRestTimerDisplay();
            });
        }

        function updateRestTimerDisplay() {
            const countdownDisplay = getElement('rest-countdown-display');
            const restStatus = getElement('rest-session-status');
            const progressBar = getElement('rest-progress-bar');
            const pauseButton = getElement('pause-rest-session');
            const resumeButton = getElement('resume-rest-session');
            const finishButton = getElement('finish-rest-session');
            const resetButton = getElement('reset-rest-session');

            if (!currentRestSession) {
                countdownDisplay.textContent = '00:00';
                restStatus.textContent = '当前没有进行中的休息计时';
                progressBar.style.width = '0%';
                pauseButton.classList.add('hidden');
                resumeButton.classList.add('hidden');
                finishButton.classList.add('hidden');
                resetButton.classList.add('hidden');
                return;
            }

            const remainingMs = getRestRemainingMs(currentRestSession);
            const remainingSeconds = Math.ceil(remainingMs / 1000);
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            const totalMs = currentRestSession.plannedMinutes * 60 * 1000;
            const progress = totalMs > 0 ? (getRestElapsedMs(currentRestSession) / totalMs) * 100 : 0;

            countdownDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            restStatus.textContent = currentRestSession.isPaused
                ? `已暂停：本次计划休息 ${currentRestSession.plannedMinutes} 分钟`
                : `休息中：本次计划 ${currentRestSession.plannedMinutes} 分钟`;
            progressBar.style.width = `${Math.max(0, Math.min(progress, 100))}%`;

            finishButton.classList.remove('hidden');
            resetButton.classList.remove('hidden');
            if (currentRestSession.isPaused) {
                pauseButton.classList.add('hidden');
                resumeButton.classList.remove('hidden');
            } else {
                pauseButton.classList.remove('hidden');
                resumeButton.classList.add('hidden');
            }
        }

        function finalizeRestSession(completed) {
            if (!currentRestSession) return null;

            const session = currentRestSession;
            const recordedDate = session.date || getTodayString();
            ensureDateData(recordedDate);

            const endTimestamp = completed ? session.endTimestamp : Date.now();
            const actualElapsedMs = completed
                ? session.plannedMinutes * 60 * 1000
                : getRestElapsedMs(session);
            const actualMinutes = completed
                ? session.plannedMinutes
                : Math.min(Math.max(1, Math.round(actualElapsedMs / (1000 * 60))), session.plannedMinutes);

            restData[recordedDate].totalMinutes += actualMinutes;
            restData[recordedDate].sessions.push({
                id: session.id,
                plannedMinutes: session.plannedMinutes,
                actualMinutes,
                completed,
                startTime: new Date(session.originalStartTimestamp || session.startTimestamp).toTimeString().slice(0, 5),
                endTime: new Date(endTimestamp).toTimeString().slice(0, 5)
            });

            currentRestSession = null;
            setTickHandler('rest', null);
            restTimer = null;

            saveData();
            updateRestTimerDisplay();
            updateTodayRestSummary();
            updateSummaryStatistics();

            if (!getElement('stats-section').classList.contains('hidden')) {
                updateStatisticsCharts(getActiveStatsPeriod());
            }

            return session;
        }

        function showRestCompletionPopup(message) {
            getElement('focus-completion-title').textContent = '休息结束';
            getElement('focus-completion-message').textContent = message;
            getElement('focus-completion-popup').classList.remove('hidden');
        }

        function startRestTitleReminder() {
            stopRestTitleReminder();
            let showAlertTitle = true;
            document.title = '休息结束 - 回到学习';
            restTitleTimer = setInterval(() => {
                document.title = showAlertTitle ? (focusOriginalTitle || '研究生工位打卡与时间管理系统') : '休息结束 - 回到学习';
                showAlertTitle = !showAlertTitle;
            }, 1000);
        }

        function stopRestTitleReminder() {
            if (restTitleTimer) {
                clearInterval(restTitleTimer);
                restTitleTimer = null;
            }
            document.title = focusOriginalTitle || '研究生工位打卡与时间管理系统';
        }

        function dismissRestCompletionReminder(options = {}) {
            getElement('focus-completion-popup').classList.add('hidden');
            stopFocusReminderSound();
            stopRestTitleReminder();
            const reminderId = options.sessionId || pendingRestCompletionReminderId;
            if (!options.skipDesktopAck && reminderId) {
                acknowledgeDesktopRestReminder(reminderId);
            }
            if (!options.sessionId || options.sessionId === pendingRestCompletionReminderId) {
                pendingRestCompletionReminderId = null;
            }
        }

        function showRestDesktopNotification(message) {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            try {
                new Notification('休息结束', {
                    body: message,
                    requireInteraction: true
                });
            } catch (error) {
                console.warn('休息桌面通知发送失败，已保留页面提醒。', error);
            }
        }

        function showRestReminder(session) {
            const message = '休息时间结束，该回到学习状态了。';
            pendingRestCompletionReminderId = session && session.id ? session.id : null;
            showRestCompletionPopup(message);
            startFocusReminderSound();
            startRestTitleReminder();
            if (!getDesktopBridge()) {
                showRestDesktopNotification(message);
            }
            updateRestNotificationStatus();
        }

        function completeRestSession(source = 'web') {
            const session = finalizeRestSession(true);
            if (!session) return;
            showRestReminder(session);
            if (source !== 'desktop' && !getDesktopBridge()) {
                pendingRestCompletionReminderId = null;
            }
        }

        function stopRestSession(isCompleted = false) {
            const session = finalizeRestSession(isCompleted);
            if (!session) return;
            cancelDesktopRestReminder(session.id);
            if (isCompleted) {
                showRestReminder(session);
            }
        }

        function updateTodayRestSummary() {
            const today = getTodayString();
            ensureDateData(today);

            const todayRest = restData[today];
            const sessions = todayRest.sessions || [];
            getElement('rest-today-total').textContent = todayRest.totalMinutes || 0;
            getElement('rest-today-count').textContent = sessions.length;

            const lastSession = sessions[sessions.length - 1];
            getElement('rest-last-session').textContent = lastSession
                ? `${lastSession.startTime} - ${lastSession.endTime}，${lastSession.actualMinutes} 分钟`
                : '暂无';

            const container = getElement('rest-today-records');
            if (sessions.length === 0) {
                container.innerHTML = '<div class="text-gray-500">暂无休息记录</div>';
                return;
            }

            container.innerHTML = '';
            [...sessions].reverse().forEach(session => {
                const row = document.createElement('div');
                row.className = 'bg-white rounded-lg p-3 flex items-center justify-between';
                row.innerHTML = `
                    <div>
                        <div class="font-medium text-gray-800">${session.startTime} - ${session.endTime}</div>
                        <div class="text-xs text-gray-500">${session.completed ? '完整休息' : '提前结束'}，计划 ${session.plannedMinutes} 分钟</div>
                    </div>
                    <div class="text-primary font-semibold">${session.actualMinutes} 分钟</div>
                `;
                container.appendChild(row);
            });
        }

        function scheduleDesktopRestReminder(session) {
            const desktopBridge = getDesktopBridge();
            if (!desktopBridge || !session) return;

            desktopBridge.scheduleRestReminder({
                id: session.id,
                plannedMinutes: session.plannedMinutes,
                startTimestamp: session.startTimestamp,
                endTimestamp: session.endTimestamp,
                isPaused: session.isPaused
            }).catch(error => {
                console.warn('桌面休息提醒调度失败，将保留网页提醒兜底。', error);
            });
        }

        function cancelDesktopRestReminder(sessionId) {
            const desktopBridge = getDesktopBridge();
            if (!desktopBridge || !sessionId) return;

            desktopBridge.cancelRestReminder(sessionId).catch(error => {
                console.warn('取消桌面休息提醒失败。', error);
            });
        }

        function acknowledgeDesktopRestReminder(sessionId) {
            const desktopBridge = getDesktopBridge();
            if (!desktopBridge || !sessionId) return;

            desktopBridge.acknowledgeRestReminder(sessionId).catch(error => {
                console.warn('确认桌面休息提醒失败。', error);
            });
        }

        function handleDesktopRestReminderDue(payload) {
            if (!currentRestSession) return;
            if (payload && payload.sessionId && payload.sessionId !== currentRestSession.id) return;
            completeRestSession('desktop');
        }

        function handleDesktopRestReminderSnooze(payload) {
            const minutes = payload && Number.isFinite(payload.minutes) ? payload.minutes : 5;
            dismissRestCompletionReminder({ skipDesktopAck: true, sessionId: payload && payload.sessionId });
            startRestSession(minutes, { force: true });
        }
        
        function getCheckinReminderTargetMinutes(period, action) {
            const qualifiedRange = getRule(period, action).qualified;
            const allowedRange = getEffectiveAllowedRange(period, action);
            const qualifiedStart = timeToMinutes(qualifiedRange.start);
            const qualifiedEnd = timeToMinutes(qualifiedRange.end);
            const allowedStart = timeToMinutes(allowedRange.start);
            const allowedEnd = timeToMinutes(allowedRange.end);
            let targetMinutes = Math.max(qualifiedStart, qualifiedEnd - CHECKIN_REMINDER_LEAD_MINUTES);

            targetMinutes = Math.max(targetMinutes, allowedStart);
            if (targetMinutes >= allowedEnd) {
                targetMinutes = Math.max(allowedStart, allowedEnd - CHECKIN_REMINDER_LEAD_MINUTES);
            }

            return targetMinutes;
        }

        function buildDesktopCheckinReminderPlans() {
            const workDay = getWorkDayString();
            ensureDateData(workDay);

            const dayData = checkinData[workDay];
            if (!dayData || dayData.leave) {
                return { date: workDay, reminders: [] };
            }

            const reminders = [];
            const now = Date.now();
            const currentMinutes = currentTimeToMinutes({ rolloverAware: true });

            ['morning', 'afternoon', 'evening'].forEach(period => {
                ['checkIn', 'checkOut'].forEach(action => {
                    const periodData = dayData[period];
                    const isCheckIn = action === 'checkIn';
                    const alreadyDone = isCheckIn ? periodData.checkIn !== null : periodData.checkOut !== null;
                    const prerequisiteMissing = !isCheckIn && periodData.checkIn === null;
                    if (alreadyDone || prerequisiteMissing) return;

                    const allowedRange = getEffectiveAllowedRange(period, action);
                    const allowedEndMinutes = timeToMinutes(allowedRange.end);
                    if (currentMinutes >= allowedEndMinutes) return;

                    const targetMinutes = getCheckinReminderTargetMinutes(period, action);
                    const allowedEndTimestamp = workDayMinutesToTimestamp(workDay, allowedEndMinutes);
                    let targetTimestamp = workDayMinutesToTimestamp(workDay, targetMinutes);

                    if (targetTimestamp <= now && now < allowedEndTimestamp) {
                        targetTimestamp = now + 2000;
                    }

                    if (targetTimestamp >= allowedEndTimestamp) return;

                    const periodLabel = PERIOD_LABELS[period];
                    const actionLabel = ACTION_LABELS[action];
                    reminders.push({
                        id: `${workDay}_${period}_${action}`,
                        date: workDay,
                        period,
                        action,
                        targetTimestamp,
                        title: `${periodLabel}${actionLabel}打卡提醒`,
                        message: `现在需要处理${periodLabel}${actionLabel}打卡，合格窗口：${formatRuleRange(getRule(period, action).qualified)}。`
                    });
                });
            });

            return { date: workDay, reminders };
        }

        function syncDesktopCheckinReminders() {
            const desktopBridge = getDesktopBridge();
            if (!desktopBridge || typeof desktopBridge.syncCheckinReminders !== 'function') return;

            desktopBridge.syncCheckinReminders(buildDesktopCheckinReminderPlans()).catch(error => {
                console.warn('同步桌面打卡提醒失败。', error);
            });
        }

        function getCheckinMeta(dayData, period, action) {
            return dayData?.meta?.[period]?.[action] || null;
        }

        function isManualCheckin(dayData, period, action) {
            return getCheckinMeta(dayData, period, action)?.source === 'manual';
        }

        function formatCheckinValueHTML(dayData, period, action) {
            const value = dayData[period][action];
            if (!value) return '-';

            const meta = getCheckinMeta(dayData, period, action);
            const manualBadge = meta?.source === 'manual'
                ? '<span class="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">补卡</span>'
                : '';
            const nextDayBadge = meta?.isNextDay
                ? '<span class="ml-1 inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">次日</span>'
                : '';

            return `${escapeHtml(value)}${manualBadge}${nextDayBadge}`;
        }

        function formatCheckinValueText(dayData, period, action) {
            const value = dayData[period][action];
            if (!value) return '-';

            const meta = getCheckinMeta(dayData, period, action);
            const tags = [];
            if (meta?.source === 'manual') tags.push('补卡');
            if (meta?.isNextDay) tags.push('次日');
            return tags.length > 0 ? `${value}（${tags.join('，')}）` : value;
        }

        function updateCheckinStatusCell(cell, value, status) {
            if (!value) {
                cell.textContent = '-';
                cell.className = 'py-2 px-4 border-b border-gray-200';
                return;
            }

            cell.textContent = status ? '合格' : '不合格';
            cell.className = `py-2 px-4 border-b border-gray-200 ${status ? 'text-green-600' : 'text-red-600'}`;
        }

        function updateAfterCheckinChange(changedDate) {
            saveData();
            updateCheckinButtons();
            updateTodayCheckinTable();
            updateTodayStatus();
            updateSummaryStatistics();

            if (!getElement('stats-section').classList.contains('hidden')) {
                updateStatisticsCharts(getActiveStatsPeriod());
            }

            if (changedDate === getWorkDayString()) {
                updateCheckinTimeDisplay();
            }

            checkAchievements();
        }

        function openManualCheckinModal(period = 'morning', action = 'checkIn') {
            const modal = getElement('manual-checkin-modal');
            getElement('manual-checkin-date').value = getWorkDayString();
            getElement('manual-checkin-time').value = getCurrentTimeString();
            getElement('manual-checkin-period').value = period;
            getElement('manual-checkin-action').value = action;
            getElement('manual-checkin-reason').value = '';
            updateManualCheckinPreview();
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        function closeManualCheckinModal() {
            const modal = getElement('manual-checkin-modal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }

        function getManualCheckinFormValue() {
            const rawTime = getElement('manual-checkin-time').value;
            return {
                date: getElement('manual-checkin-date').value,
                period: getElement('manual-checkin-period').value,
                action: getElement('manual-checkin-action').value,
                time: rawTime ? normalizeTimeValue(rawTime) : '',
                reason: getElement('manual-checkin-reason').value.trim()
            };
        }

        function getManualCheckinRecordedMinutes(period, action, time) {
            return getRecordedCheckinMinutes(period, action, time);
        }

        function updateManualNextDayHint(period, action, time) {
            const wrap = getElement('manual-checkin-next-day-wrap');
            const checkbox = getElement('manual-checkin-next-day');
            const shouldShow = period === 'evening' && action === 'checkOut';
            const isNextDay = shouldShow && time && timeToMinutes(time) < dayRolloverHour * 60;

            wrap.classList.toggle('hidden', !shouldShow);
            wrap.classList.toggle('flex', shouldShow);
            checkbox.checked = isNextDay;
            checkbox.disabled = true;
        }

        function updateManualCheckinPreview() {
            const preview = getElement('manual-checkin-preview');
            const { date, period, action, time, reason } = getManualCheckinFormValue();

            updateManualNextDayHint(period, action, time);

            if (!date || !time || !PERIOD_LABELS[period] || !ACTION_LABELS[action]) {
                preview.textContent = '选择日期、时段、类型和时间后预览补卡结果。';
                return;
            }

            const dayData = checkinData[date]
                ? normalizeCheckinDay(safeParseJSON(JSON.stringify(checkinData[date]), createDefaultCheckinDay()))
                : createDefaultCheckinDay();
            const currentValue = dayData[period][action];
            const status = getCheckinStatusFor(period, action, time);
            const recordedMinutes = getManualCheckinRecordedMinutes(period, action, time);
            const allowedRange = action === 'checkOut' ? getEffectiveAllowedRange(period, action) : getRule(period, action).allowed;
            const inAllowedWindow = isMinuteInRange(recordedMinutes, allowedRange.start, allowedRange.end);
            const isNextDay = period === 'evening' && action === 'checkOut' && recordedMinutes >= 1440;
            const statusClass = status ? 'text-green-700' : 'text-red-600';
            const allowedText = inAllowedWindow ? '在可打卡时间窗内' : '不在可打卡时间窗内';
            const reasonText = reason ? `原因：${escapeHtml(reason)}` : '原因：未填写';

            preview.innerHTML = `
                <div class="font-medium ${statusClass}">${PERIOD_LABELS[period]}${ACTION_LABELS[action]}将判定为：${status ? '合格' : '不合格'}</div>
                <div class="mt-1">工作日：${escapeHtml(date)}；实际时间：${isNextDay ? '次日 ' : ''}${escapeHtml(time)}；${allowedText}。</div>
                <div class="mt-1">合格窗口：${formatRuleRange(getRule(period, action).qualified)}。</div>
                <div class="mt-1">${currentValue ? `当前已有记录：${escapeHtml(currentValue)}，保存时会要求确认覆盖。` : '当前为空，将新增补卡记录。'}</div>
                <div class="mt-1 text-gray-500">${reasonText}</div>
            `;
        }

        function saveManualCheckin() {
            const { date, period, action, time, reason } = getManualCheckinFormValue();

            if (!date) {
                alert('请选择补卡所属的工作日日期。');
                return;
            }
            if (!time) {
                alert('请选择实际打卡时间。');
                return;
            }
            if (!PERIOD_LABELS[period] || !ACTION_LABELS[action]) {
                alert('请选择有效的打卡时段和类型。');
                return;
            }

            const dayData = ensureCheckinDateData(date);
            if (dayData.leave) {
                const shouldContinue = confirm('所选日期当前标记为请假。仍然要补卡吗？');
                if (!shouldContinue) return;
            }

            const existingValue = dayData[period][action];
            const existingMeta = getCheckinMeta(dayData, period, action);
            if (existingValue) {
                const shouldOverwrite = confirm(`${PERIOD_LABELS[period]}${ACTION_LABELS[action]}已有记录 ${existingValue}。是否覆盖为 ${time}？`);
                if (!shouldOverwrite) return;
            }

            const recordedMinutes = getManualCheckinRecordedMinutes(period, action, time);
            dayData[period][action] = time;
            dayData[period].status[action] = getCheckinStatusFor(period, action, time);
            dayData.meta[period][action] = {
                source: 'manual',
                reason,
                createdAt: new Date().toISOString(),
                previousValue: existingValue || null,
                previousMeta: existingMeta || null,
                isNextDay: period === 'evening' && action === 'checkOut' && recordedMinutes >= 1440
            };

            updateAfterCheckinChange(date);
            closeManualCheckinModal();
        }

        // 初始化打卡功能
        function initCheckin() {
            // 上午打卡
            getElement('morning-checkin').addEventListener('click', function() {
                checkIn('morning');
            });
            
            getElement('morning-checkout').addEventListener('click', function() {
                checkOut('morning');
            });
            
            // 下午打卡
            getElement('afternoon-checkin').addEventListener('click', function() {
                checkIn('afternoon');
            });
            
            getElement('afternoon-checkout').addEventListener('click', function() {
                checkOut('afternoon');
            });
            
            // 晚上打卡
            getElement('evening-checkin').addEventListener('click', function() {
                checkIn('evening');
            });
            
            getElement('evening-checkout').addEventListener('click', function() {
                checkOut('evening');
            });

            getElement('open-manual-checkin').addEventListener('click', function() {
                openManualCheckinModal();
            });

            getElement('close-manual-checkin').addEventListener('click', closeManualCheckinModal);
            getElement('cancel-manual-checkin').addEventListener('click', closeManualCheckinModal);
            getElement('save-manual-checkin').addEventListener('click', saveManualCheckin);
            getElement('manual-checkin-modal').addEventListener('click', function(event) {
                if (event.target === this) {
                    closeManualCheckinModal();
                }
            });

            ['manual-checkin-date', 'manual-checkin-time', 'manual-checkin-period', 'manual-checkin-action', 'manual-checkin-reason'].forEach(id => {
                getElement(id).addEventListener('input', updateManualCheckinPreview);
                getElement(id).addEventListener('change', updateManualCheckinPreview);
            });
            
            // 更新打卡按钮状态
            updateCheckinButtons();
            
            // 更新今日打卡记录表格
            updateTodayCheckinTable();
        }
        
        // 更新打卡按钮状态
        function updateCheckinButtons() {
            const today = getWorkDayString();
            ensureDateData(today);
            const currentMinutes = currentTimeToMinutes({ rolloverAware: true });
            const dayData = checkinData[today];
            const periods = ['morning', 'afternoon', 'evening'];

            // 检查是否请假
            const isLeave = dayData.leave;
            if (isLeave) {
                // 如果请假，禁用所有打卡按钮
                periods.forEach(period => {
                    setButtonState(getElement(`${period}-checkin`), false);
                    setButtonState(getElement(`${period}-checkout`), false);
                });
                syncDesktopCheckinReminders();
                return;
            }

            periods.forEach(period => {
                const periodData = dayData[period];
                const checkInAllowed = getEffectiveAllowedRange(period, 'checkIn');
                const checkOutAllowed = getEffectiveAllowedRange(period, 'checkOut');
                const canCheckIn = periodData.checkIn === null && isMinuteInRange(currentMinutes, checkInAllowed.start, checkInAllowed.end, false);
                const canCheckOut = periodData.checkOut === null && periodData.checkIn !== null && isMinuteInRange(currentMinutes, checkOutAllowed.start, checkOutAllowed.end, false);

                setButtonState(getElement(`${period}-checkin`), canCheckIn);
                setButtonState(getElement(`${period}-checkout`), canCheckOut);
            });

            syncDesktopCheckinReminders();
            
            // 更新打卡时间显示
            updateCheckinTimeDisplay();
        }
        
        // 上班打卡
        function checkIn(period) {
            const today = getWorkDayString();
            ensureDateData(today);
            const currentTime = getCurrentTimeString();

            // 记录打卡时间
            checkinData[today][period].checkIn = currentTime;
            checkinData[today][period].status.checkIn = getCheckinStatusFor(period, 'checkIn', currentTime);
            checkinData[today].meta[period].checkIn = null;

            updateAfterCheckinChange(today);
        }
        
        // 下班打卡
        function checkOut(period) {
            const today = getWorkDayString();
            ensureDateData(today);
            const currentTime = getCurrentTimeString();

            // 记录打卡时间
            checkinData[today][period].checkOut = currentTime;
            checkinData[today][period].status.checkOut = getCheckinStatusFor(period, 'checkOut', currentTime);
            checkinData[today].meta[period].checkOut = null;

            updateAfterCheckinChange(today);
        }
        
        // 更新打卡时间显示
        function updateCheckinTimeDisplay() {
            const today = getWorkDayString();
            ensureDateData(today);
            const dayData = checkinData[today];
            
            // 上午打卡时间
            getElement('morning-checkin-time').textContent = `上班: ${formatCheckinValueText(dayData, 'morning', 'checkIn')}`;
            getElement('morning-checkout-time').textContent = `下班: ${formatCheckinValueText(dayData, 'morning', 'checkOut')}`;
            
            // 下午打卡时间
            getElement('afternoon-checkin-time').textContent = `上班: ${formatCheckinValueText(dayData, 'afternoon', 'checkIn')}`;
            getElement('afternoon-checkout-time').textContent = `下班: ${formatCheckinValueText(dayData, 'afternoon', 'checkOut')}`;
            
            // 晚上打卡时间
            getElement('evening-checkin-time').textContent = `上班: ${formatCheckinValueText(dayData, 'evening', 'checkIn')}`;
            getElement('evening-checkout-time').textContent = `下班: ${formatCheckinValueText(dayData, 'evening', 'checkOut')}`;
        }
        
        // 更新今日打卡记录表格
        function updateTodayCheckinTable() {
            const today = getWorkDayString();
            ensureDateData(today);
            const dayData = checkinData[today];

            CHECKIN_PERIODS.forEach(period => {
                getElement(`table-${period}-checkin`).innerHTML = formatCheckinValueHTML(dayData, period, 'checkIn');
                getElement(`table-${period}-checkout`).innerHTML = formatCheckinValueHTML(dayData, period, 'checkOut');
                updateCheckinStatusCell(
                    getElement(`table-${period}-checkin-status`),
                    dayData[period].checkIn,
                    dayData[period].status.checkIn
                );
                updateCheckinStatusCell(
                    getElement(`table-${period}-checkout-status`),
                    dayData[period].checkOut,
                    dayData[period].status.checkOut
                );
            });
        }
        
        // 初始化手机克制功能
        function initPhoneResist() {
            // 更新总次数显示
            getElement('phone-resist-count').textContent = phoneResistData.totalCount;
            
            // 更新今日次数显示
            const today = getTodayString();
            getElement('today-phone-resist-count').textContent = phoneResistData.records[today].count;
            
            // 更新今日记录时间
            updateTodayPhoneResistTimes();
            
            // 更新成就列表
            updateAchievementsList();
            
            // 添加忍住按钮事件
            getElement('add-phone-resist').addEventListener('click', function() {
                addPhoneResist();
            });
        }
        
        // 添加手机克制记录
        function addPhoneResist() {
            const today = getTodayString();
            const currentTime = getCurrentTimeString();
            
            // 更新总次数
            phoneResistData.totalCount++;
            
            // 更新今日次数
            if (!phoneResistData.records[today]) {
                phoneResistData.records[today] = { count: 0, times: [] };
            }
            phoneResistData.records[today].count++;
            phoneResistData.records[today].times.push(currentTime);
            
            // 保存数据
            saveData();
            
            // 更新显示
            getElement('phone-resist-count').textContent = phoneResistData.totalCount;
            getElement('today-phone-resist-count').textContent = phoneResistData.records[today].count;
            
            // 更新今日记录时间
            updateTodayPhoneResistTimes();
            
            // 更新成就列表
            updateAchievementsList();
            
            // 检查成就
            checkAchievements();
        }
        
        // 更新今日手机克制记录时间
        function updateTodayPhoneResistTimes() {
            const today = getTodayString();
            const times = phoneResistData.records[today].times;
            
            if (times.length === 0) {
                getElement('today-phone-resist-times').textContent = '暂无记录';
                return;
            }
            
            let timesText = '记录时间: ';
            timesText += times.join(', ');
            
            getElement('today-phone-resist-times').textContent = timesText;
        }
        
        // 更新成就列表
        function updateAchievementsList() {
            const achievementsList = getElement('achievements-list');
            achievementsList.innerHTML = '';
            const fragment = document.createDocumentFragment();
            
            achievementList.forEach(achievement => {
                // 只显示手机克制相关成就
                if (achievement.type && achievement.type !== 'phone') return;
                
                const isAchieved = achievements.includes(achievement.id);
                const statusClass = isAchieved ? 'bg-success' : 'bg-gray-300';
                const iconClass = isAchieved ? 'fa-check' : 'fa-lock';
                const textClass = isAchieved ? '' : 'text-gray-500';
                
                const achievementItem = document.createElement('div');
                achievementItem.className = 'flex items-center';
                achievementItem.innerHTML = `
                    <div class="w-8 h-8 rounded-full ${statusClass} flex items-center justify-center text-white mr-2">
                        <i class="fa ${iconClass}"></i>
                    </div>
                    <div>
                        <div class="font-medium ${textClass}">${achievement.name}</div>
                        <div class="text-xs ${textClass}">${achievement.description}</div>
                    </div>
                `;
                
                fragment.appendChild(achievementItem);
            });

            achievementsList.appendChild(fragment);
        }
        
        // 显示成就弹窗
        function showAchievementPopup(achievement) {
            const popup = getElement('achievement-popup');
            getElement('popup-achievement-title').textContent = achievement.name;
            getElement('popup-achievement-desc').textContent = achievement.description;
            
            popup.classList.remove('hidden');
            
            // 5秒后隐藏弹窗
            setTimeout(() => {
                popup.classList.add('hidden');
            }, 5000);
        }
        
        // 检查成就
        function checkAchievements() {
            let hasNewAchievement = false;
            
            // 检查手机克制成就
            achievementList.forEach(achievement => {
                if (achievements.includes(achievement.id)) return;
                
                let achieved = false;
                
                if (achievement.type === 'phone' || !achievement.type) {
                    achieved = phoneResistData.totalCount >= achievement.requirement;
                } else if (achievement.type === 'checkin') {
                    // 计算总打卡天数
                    const checkinDays = Object.keys(checkinData).filter(date => {
                        const dayData = checkinData[date];
                        return dayData.morning.checkIn || dayData.afternoon.checkIn || dayData.evening.checkIn;
                    }).length;
                    achieved = checkinDays >= achievement.requirement;
                } else if (achievement.type === 'streak') {
                    // 计算连续打卡天数
                    const streak = calculateCheckinStreak();
                    achieved = streak >= achievement.requirement;
                } else if (achievement.type === 'task') {
                    // 计算总任务数
                    const totalTasks = Object.values(taskData).reduce((total, dayTasks) => {
                        return total + dayTasks.length;
                    }, 0);
                    achieved = totalTasks >= achievement.requirement;
                } else if (achievement.type === 'task_hour') {
                    // 计算总任务时间(小时)
                    const totalHours = calculateTotalTaskHours();
                    achieved = totalHours >= achievement.requirement;
                }
                
                if (achieved) {
                    achievements.push(achievement.id);
                    showAchievementPopup(achievement);
                    hasNewAchievement = true;
                }
            });
            
            if (hasNewAchievement) {
                saveData();
                updateAchievementsList();
                updateTodayStatus();
            }
        }
        
        // 计算连续打卡天数
        function calculateCheckinStreak() {
            const dates = Object.keys(checkinData).sort().reverse();
            if (dates.length === 0) return 0;
            
            let streak = 0;
            const today = new Date();
            
            for (let i = 0; i < dates.length; i++) {
                const checkDate = parseStoredDate(dates[i]);
                const expectedDate = new Date(today);
                expectedDate.setDate(today.getDate() - i);
                
                // 检查日期是否连续
                if (!checkDate || checkDate.toDateString() !== expectedDate.toDateString()) {
                    break;
                }
                
                const dayData = checkinData[dates[i]];
                if (dayData.morning.checkIn || dayData.afternoon.checkIn || dayData.evening.checkIn) {
                    streak++;
                } else {
                    break;
                }
            }
            
            return streak;
        }
        
        // 计算总任务时间(小时)
        function calculateTotalTaskHours() {
            let totalMinutes = 0;
            
            Object.values(taskData).forEach(dayTasks => {
                dayTasks.forEach(task => {
                    if (task.duration) {
                        totalMinutes += task.duration;
                    }
                });
            });
            
            return Math.floor(totalMinutes / 60);
        }
        
        // 初始化任务管理功能
        function initTaskManagement() {
            // 开始任务按钮事件
            getElement('start-task').addEventListener('click', function() {
                startTask();
            });
            
            // 结束任务按钮事件
            getElement('end-task').addEventListener('click', function() {
                endTask();
            });
            
            // 更新今日任务列表
            updateTodayTasksList();
            
            // 更新日程表
            updateSchedule();
            
            // 恢复进行中的任务
            restoreCurrentTask();
        }
        
        function restoreCurrentTask() {
            if (!currentTask) return;
            
            getElement('current-task-name').textContent = currentTask.name;
            getElement('current-task-container').classList.remove('hidden');
            startTaskTimer();
        }
        
        // 开始任务
        function startTask() {
            const taskName = getElement('task-name').value.trim();
            
            if (!taskName) {
                alert('请输入任务名称');
                return;
            }
            
            // 如果有正在进行的任务，先结束
            if (currentTask) {
                endTask();
            }
            
            // 创建新任务
            const today = getTodayString();
            const taskId = 'task_' + Date.now();
            const startTime = getCurrentTimeString();
            
            currentTask = {
                id: taskId,
                name: taskName,
                date: today,
                startTime: startTime,
                startTimestamp: Date.now()
            };
            
            // 显示当前任务
            getElement('current-task-name').textContent = taskName;
            getElement('current-task-time').textContent = '已进行: 00:00:00';
            getElement('current-task-container').classList.remove('hidden');
            
            // 清空输入框
            getElement('task-name').value = '';
            
            // 启动计时器
            startTaskTimer();
            
            // 立即持久化进行中任务
            saveData();
            
            // 更新今日状态
            updateTodayStatus();
        }
        
        // 启动任务计时器
        function startTaskTimer() {
            taskTimer = true;
            setTickHandler('task', () => {
                if (!currentTask) return;
                
                const elapsedTime = Date.now() - currentTask.startTimestamp;
                const hours = Math.floor(elapsedTime / (1000 * 60 * 60));
                const minutes = Math.floor((elapsedTime % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((elapsedTime % (1000 * 60)) / 1000);
                
                const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                getElement('current-task-time').textContent = `已进行: ${timeString}`;
                
                // 更新进度条 (假设任务最长10小时)
                const progress = Math.min((elapsedTime / (1000 * 60 * 60 * 10)) * 100, 100);
                getElement('task-progress-bar').style.width = `${progress}%`;
            });
        }
        
        // 结束任务
        function endTask() {
            if (!currentTask) return;
            
            // 停止计时器
            setTickHandler('task', null);
            taskTimer = null;
            
            // 计算任务持续时间
            const endTime = getCurrentTimeString();
            const duration = Math.floor((Date.now() - currentTask.startTimestamp) / (1000 * 60)); // 分钟
            
            // 保存任务数据
            const today = currentTask.date || getTodayString();
            const task = {
                id: currentTask.id,
                name: currentTask.name,
                startTime: currentTask.startTime,
                endTime: endTime,
                duration: duration,
                completed: true
            };
            
            if (!taskData[today]) {
                taskData[today] = [];
            }
            
            taskData[today].push(task);
            
            // 重置当前任务
            currentTask = null;
            
            // 隐藏当前任务容器
            getElement('current-task-container').classList.add('hidden');
            getElement('task-progress-bar').style.width = '0%';
            
            // 保存数据
            saveData();
            
            // 更新今日任务列表
            updateTodayTasksList();
            
            // 更新日程表
            updateSchedule();
            
            // 更新今日状态
            updateTodayStatus();
            
            // 检查成就
            checkAchievements();
        }
        
        // 更新今日任务列表
        function updateTodayTasksList() {
            const today = getTodayString();
            const tasks = taskData[today] || [];
            const tableBody = getElement('today-tasks-table');
            
            if (tasks.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="5" class="py-4 px-4 text-center text-gray-500">暂无任务记录</td></tr>';
                return;
            }
            
            tableBody.innerHTML = '';
            const fragment = document.createDocumentFragment();
            
            tasks.forEach(task => {
                const row = document.createElement('tr');
                
                // 格式化持续时间
                const hours = Math.floor(task.duration / 60);
                const minutes = task.duration % 60;
                const durationString = hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
                
                row.innerHTML = `
                    <td class="py-2 px-4 border-b border-gray-200">${task.name}</td>
                    <td class="py-2 px-4 border-b border-gray-200">${task.startTime}</td>
                    <td class="py-2 px-4 border-b border-gray-200">${task.endTime}</td>
                    <td class="py-2 px-4 border-b border-gray-200">${durationString}</td>
                    <td class="py-2 px-4 border-b border-gray-200">
                        <span class="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">已完成</span>
                    </td>
                `;
                
                fragment.appendChild(row);
            });

            tableBody.appendChild(fragment);
        }
        
        // 更新日程表
        function updateSchedule() {
            const today = getTodayString();
            const tasks = taskData[today] || [];
            const scheduleContent = getElement('schedule-content');
            
            if (tasks.length === 0) {
                scheduleContent.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-gray-500">暂无日程安排</div>';
                return;
            }
            
            scheduleContent.innerHTML = '';
            const fragment = document.createDocumentFragment();
            
            // 计算时间块高度 (总高度 / 18小时 = 每小时高度)
            const totalHeight = 384; // 96 * 4 = 384px
            const hourHeight = totalHeight / 18; // 6:00 - 24:00 共18小时
            
            tasks.forEach(task => {
                // 解析开始时间和结束时间
                const [startHour, startMinute] = task.startTime.split(':').map(Number);
                const [endHour, endMinute] = task.endTime.split(':').map(Number);
                
                // 计算顶部位置 (相对于6:00的偏移)
                const startOffset = (startHour - 6) + (startMinute / 60);
                const top = startOffset * hourHeight;
                
                // 计算高度
                const durationHours = (endHour - startHour) + ((endMinute - startMinute) / 60);
                const height = durationHours * hourHeight;
                
                // 创建任务块
                const taskBlock = document.createElement('div');
                taskBlock.className = 'absolute left-0 right-0 bg-primary/80 text-white p-2 rounded-md shadow-md cursor-pointer hover:bg-primary transition-colors';
                taskBlock.style.top = `${top}px`;
                taskBlock.style.height = `${height}px`;
                taskBlock.style.minHeight = '30px'; // 最小高度
                
                taskBlock.innerHTML = `
                    <div class="font-medium text-sm truncate">${task.name}</div>
                    <div class="text-xs opacity-80">${task.startTime} - ${task.endTime}</div>
                `;
                
                fragment.appendChild(taskBlock);
            });

            scheduleContent.appendChild(fragment);
        }
        
        // 初始化请假功能
        function initLeaveManagement() {
            // 设置默认请假日期为今天
            const today = getTodayString();
            getElement('leave-date').value = today;
            
            // 添加请假按钮事件
            getElement('add-leave').addEventListener('click', function() {
                addLeave();
            });

            getElement('leave-records-table').addEventListener('click', function(event) {
                const deleteButton = event.target.closest('.delete-leave');
                if (!deleteButton) return;
                deleteLeave(deleteButton.getAttribute('data-date'));
            });
            
            // 更新请假记录列表
            updateLeaveRecordsList();
        }
        
        // 添加请假记录
        function addLeave() {
            const date = getElement('leave-date').value;
            const reason = getElement('leave-reason').value.trim();
            
            if (!date) {
                alert('请选择请假日期');
                return;
            }
            
            if (!reason) {
                alert('请输入请假理由');
                return;
            }
            
            // 检查是否已有该日期的请假记录
            const existingLeaveIndex = leaveData.findIndex(leave => leave.date === date);
            
            if (existingLeaveIndex !== -1) {
                // 更新现有记录
                leaveData[existingLeaveIndex].reason = reason;
            } else {
                // 添加新记录
                leaveData.push({ date, reason });
            }
            
            // 更新打卡数据
            if (!checkinData[date]) {
                checkinData[date] = {
                    morning: { checkIn: null, checkOut: null, status: { checkIn: null, checkOut: null } },
                    afternoon: { checkIn: null, checkOut: null, status: { checkIn: null, checkOut: null } },
                    evening: { checkIn: null, checkOut: null, status: { checkIn: null, checkOut: null } },
                    leave: false,
                    leaveReason: ''
                };
            }
            
            checkinData[date].leave = true;
            checkinData[date].leaveReason = reason;
            
            // 保存数据
            saveData();
            
            // 清空输入框
            getElement('leave-reason').value = '';
            
            // 更新请假记录列表
            updateLeaveRecordsList();
            
            // 如果是今天的请假，更新打卡按钮状态
            if (date === getWorkDayString()) {
                updateCheckinButtons();
                updateTodayStatus();
            }
        }
        
        // 更新请假记录列表
        function updateLeaveRecordsList() {
            const tableBody = getElement('leave-records-table');
            
            if (leaveData.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="3" class="py-4 px-4 text-center text-gray-500">暂无请假记录</td></tr>';
                return;
            }
            
            // 按日期排序 (最新的在前)
            const sortedLeaveData = [...leaveData].sort((a, b) => parseStoredDate(b.date) - parseStoredDate(a.date));
            
            tableBody.innerHTML = '';
            const fragment = document.createDocumentFragment();
            
            sortedLeaveData.forEach(leave => {
                const row = document.createElement('tr');
                
                // 格式化日期
                const date = parseStoredDate(leave.date);
                const formattedDate = date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
                
                row.innerHTML = `
                    <td class="py-2 px-4 border-b border-gray-200">${formattedDate}</td>
                    <td class="py-2 px-4 border-b border-gray-200">${leave.reason}</td>
                    <td class="py-2 px-4 border-b border-gray-200">
                        <button class="delete-leave px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs" data-date="${leave.date}">删除</button>
                    </td>
                `;
                
                fragment.appendChild(row);
            });

            tableBody.appendChild(fragment);
        }
        
        // 删除请假记录
        function deleteLeave(date) {
            if (confirm('确定要删除这条请假记录吗？')) {
                // 从请假数据中删除
                leaveData = leaveData.filter(leave => leave.date !== date);
                
                // 更新打卡数据
                if (checkinData[date]) {
                    checkinData[date].leave = false;
                    checkinData[date].leaveReason = '';
                }
                
                // 保存数据
                saveData();
                
                // 更新请假记录列表
                updateLeaveRecordsList();
                
                // 如果是今天的请假，更新打卡按钮状态
                if (date === getWorkDayString()) {
                    updateCheckinButtons();
                    updateTodayStatus();
                }
            }
        }
        
        // 初始化统计分析功能
        function initStatistics() {
            getElement('stats-section').addEventListener('click', function(event) {
                const button = event.target.closest('.stats-period-btn');
                if (!button) return;

                const period = button.getAttribute('data-period');

                document.querySelectorAll('.stats-period-btn').forEach(btn => {
                    btn.classList.remove('bg-primary', 'text-white');
                    btn.classList.add('bg-gray-200', 'text-gray-700');
                });

                button.classList.add('bg-primary', 'text-white');
                button.classList.remove('bg-gray-200', 'text-gray-700');

                updateStatisticsCharts(period);
            });
            
            // 更新综合统计
            updateSummaryStatistics();
        }

        function loadChartJs() {
            if (window.Chart) return Promise.resolve(window.Chart);
            if (chartJsLoadPromise) return chartJsLoadPromise;

            chartJsLoadPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = CHART_JS_URL;
                script.async = true;
                script.onload = () => resolve(window.Chart);
                script.onerror = () => reject(new Error('Chart.js 加载失败'));
                document.head.appendChild(script);
            });

            return chartJsLoadPromise;
        }

        function getActiveStatsPeriod() {
            const activeButton = document.querySelector('.stats-period-btn.bg-primary');
            return activeButton ? activeButton.getAttribute('data-period') : 'week';
        }
        
        // 更新统计图表
        async function updateStatisticsCharts(period) {
            if (!isSectionVisible('stats-section')) return;

            try {
                await loadChartJs();
            } catch (error) {
                console.error('统计图表库加载失败。', error);
                return;
            }

            if (!statsDataDirty && statsDataCache[period]) {
                renderStatisticsCharts(statsDataCache[period]);
                return;
            }

            const { startDate, endDate, labels } = getDateRange(period);
            statsDataCache[period] = {
                labels,
                checkinRateData: prepareCheckinRateData(startDate, endDate, labels),
                checkinPeriodData: prepareCheckinPeriodData(startDate, endDate),
                taskDurationData: prepareTaskDurationData(startDate, endDate, labels),
                phoneResistData: preparePhoneResistData(startDate, endDate, labels),
                focusDurationData: prepareFocusDurationData(startDate, endDate, labels),
                restDurationData: prepareRestDurationData(startDate, endDate, labels)
            };
            statsDataDirty = false;
            renderStatisticsCharts(statsDataCache[period]);
        }

        function renderStatisticsCharts(stats) {
            updateCheckinRateChart(stats.labels, stats.checkinRateData);
            updateCheckinPeriodChart(stats.checkinPeriodData);
            updateTaskDurationChart(stats.labels, stats.taskDurationData);
            updatePhoneResistChart(stats.labels, stats.phoneResistData);
            updateFocusDurationChart(stats.labels, stats.focusDurationData);
            updateRestDurationChart(stats.labels, stats.restDurationData);
        }

        function updateChartInstance(chartKey, canvasId, config) {
            if (window[chartKey]) {
                window[chartKey].data = config.data;
                window[chartKey].options = config.options;
                window[chartKey].update();
                return;
            }

            const canvas = getElement(canvasId);
            if (!canvas || !window.Chart) return;
            const ctx = canvas.getContext('2d');
            window[chartKey] = new window.Chart(ctx, config);
        }
        
        // 获取日期范围
        function getDateRange(period) {
            const endDate = new Date();
            const startDate = new Date();
            let labels = [];
            
            if (period === 'week') {
                startDate.setDate(endDate.getDate() - 6); // 最近7天
                for (let i = 0; i < 7; i++) {
                    const date = new Date(startDate);
                    date.setDate(startDate.getDate() + i);
                    labels.push(date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }));
                }
            } else if (period === 'month') {
                startDate.setDate(endDate.getDate() - 29); // 最近30天
                for (let i = 0; i < 30; i += 3) {
                    const date = new Date(startDate);
                    date.setDate(startDate.getDate() + i);
                    labels.push(date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }));
                }
            } else if (period === 'year') {
                startDate.setMonth(endDate.getMonth() - 11); // 最近12个月
                for (let i = 0; i < 12; i++) {
                    const date = new Date(startDate);
                    date.setMonth(startDate.getMonth() + i);
                    labels.push(date.toLocaleDateString('zh-CN', { month: 'short' }));
                }
            }
            
            return { startDate, endDate, labels };
        }
        
        // 准备打卡率数据
        function prepareCheckinRateData(startDate, endDate, labels) {
            const data = [];
            const dateFormat = { year: 'numeric', month: '2-digit', day: '2-digit' };
            
            for (let i = 0; i < labels.length; i++) {
                const date = new Date(startDate);
                if (labels.length === 7) { // 周
                    date.setDate(startDate.getDate() + i);
                } else if (labels.length === 10) { // 月
                    date.setDate(startDate.getDate() + i * 3);
                } else if (labels.length === 12) { // 年
                    date.setMonth(startDate.getMonth() + i);
                }
                
                    const dateString = formatLocalDate(date);
                const dayData = checkinData[dateString];
                
                if (!dayData || dayData.leave) {
                    data.push(null); // 请假或无数据
                } else {
                    // 计算打卡率 (合格次数 / 应打卡次数)
                    let totalChecks = 0;
                    let qualifiedChecks = 0;
                    
                    ['morning', 'afternoon', 'evening'].forEach(period => {
                        if (dayData[period].checkIn !== null) {
                            totalChecks++;
                            if (dayData[period].status.checkIn) qualifiedChecks++;
                        }
                        
                        if (dayData[period].checkOut !== null) {
                            totalChecks++;
                            if (dayData[period].status.checkOut) qualifiedChecks++;
                        }
                    });
                    
                    const rate = totalChecks > 0 ? (qualifiedChecks / totalChecks) * 100 : 0;
                    data.push(rate);
                }
            }
            
            return data;
        }
        
        // 准备时段打卡数据
        function prepareCheckinPeriodData(startDate, endDate) {
            const morning = { checkIn: 0, checkOut: 0, qualifiedCheckIn: 0, qualifiedCheckOut: 0 };
            const afternoon = { checkIn: 0, checkOut: 0, qualifiedCheckIn: 0, qualifiedCheckOut: 0 };
            const evening = { checkIn: 0, checkOut: 0, qualifiedCheckIn: 0, qualifiedCheckOut: 0 };
            
            // 遍历日期范围
            const currentDate = new Date(startDate);
            while (currentDate <= endDate) {
                const dateString = formatLocalDate(currentDate);
                const dayData = checkinData[dateString];
                
                if (dayData && !dayData.leave) {
                    // 上午
                    if (dayData.morning.checkIn) {
                        morning.checkIn++;
                        if (dayData.morning.status.checkIn) morning.qualifiedCheckIn++;
                    }
                    if (dayData.morning.checkOut) {
                        morning.checkOut++;
                        if (dayData.morning.status.checkOut) morning.qualifiedCheckOut++;
                    }
                    
                    // 下午
                    if (dayData.afternoon.checkIn) {
                        afternoon.checkIn++;
                        if (dayData.afternoon.status.checkIn) afternoon.qualifiedCheckIn++;
                    }
                    if (dayData.afternoon.checkOut) {
                        afternoon.checkOut++;
                        if (dayData.afternoon.status.checkOut) afternoon.qualifiedCheckOut++;
                    }
                    
                    // 晚上
                    if (dayData.evening.checkIn) {
                        evening.checkIn++;
                        if (dayData.evening.status.checkIn) evening.qualifiedCheckIn++;
                    }
                    if (dayData.evening.checkOut) {
                        evening.checkOut++;
                        if (dayData.evening.status.checkOut) evening.qualifiedCheckOut++;
                    }
                }
                
                currentDate.setDate(currentDate.getDate() + 1);
            }
            
            return { morning, afternoon, evening };
        }
        
        // 准备任务时长数据
        function prepareTaskDurationData(startDate, endDate, labels) {
            const data = [];
            
            for (let i = 0; i < labels.length; i++) {
                const date = new Date(startDate);
                if (labels.length === 7) { // 周
                    date.setDate(startDate.getDate() + i);
                } else if (labels.length === 10) { // 月
                    date.setDate(startDate.getDate() + i * 3);
                } else if (labels.length === 12) { // 年
                    date.setMonth(startDate.getMonth() + i);
                    
                    // 计算月总时长
                    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
                    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
                    let monthTotal = 0;
                    
                    const monthCurrent = new Date(monthStart);
                    while (monthCurrent <= monthEnd) {
                    const monthDateString = formatLocalDate(monthCurrent);
                        const dayTasks = taskData[monthDateString] || [];
                        
                        dayTasks.forEach(task => {
                            monthTotal += task.duration;
                        });
                        
                        monthCurrent.setDate(monthCurrent.getDate() + 1);
                    }
                    
                    data.push(monthTotal / 60); // 转换为小时
                    continue;
                }
                
                const dateString = formatLocalDate(date);
                const dayTasks = taskData[dateString] || [];
                
                // 计算日总时长
                let dayTotal = 0;
                dayTasks.forEach(task => {
                    dayTotal += task.duration;
                });
                
                data.push(dayTotal / 60); // 转换为小时
            }
            
            return data;
        }
        
        // 准备手机克制数据
        function preparePhoneResistData(startDate, endDate, labels) {
            const data = [];
            
            for (let i = 0; i < labels.length; i++) {
                const date = new Date(startDate);
                if (labels.length === 7) { // 周
                    date.setDate(startDate.getDate() + i);
                } else if (labels.length === 10) { // 月
                    date.setDate(startDate.getDate() + i * 3);
                } else if (labels.length === 12) { // 年
                    date.setMonth(startDate.getMonth() + i);
                    
                    // 计算月总次数
                    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
                    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
                    let monthTotal = 0;
                    
                    const monthCurrent = new Date(monthStart);
                    while (monthCurrent <= monthEnd) {
                    const monthDateString = formatLocalDate(monthCurrent);
                        if (phoneResistData.records[monthDateString]) {
                            monthTotal += phoneResistData.records[monthDateString].count;
                        }
                        monthCurrent.setDate(monthCurrent.getDate() + 1);
                    }
                    
                    data.push(monthTotal);
                    continue;
                }
                
                const dateString = formatLocalDate(date);
                const dayRecord = phoneResistData.records[dateString];
                
                data.push(dayRecord ? dayRecord.count : 0);
            }
            
            return data;
        }

        function prepareFocusDurationData(startDate, endDate, labels) {
            const data = [];

            for (let i = 0; i < labels.length; i++) {
                const date = new Date(startDate);
                if (labels.length === 7) {
                    date.setDate(startDate.getDate() + i);
                } else if (labels.length === 10) {
                    date.setDate(startDate.getDate() + i * 3);
                } else if (labels.length === 12) {
                    date.setMonth(startDate.getMonth() + i);

                    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
                    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
                    let monthTotal = 0;

                    const monthCurrent = new Date(monthStart);
                    while (monthCurrent <= monthEnd) {
                        const monthDateString = formatLocalDate(monthCurrent);
                        if (focusData[monthDateString]) {
                            monthTotal += focusData[monthDateString].totalMinutes;
                        }
                        monthCurrent.setDate(monthCurrent.getDate() + 1);
                    }

                    data.push(monthTotal / 60);
                    continue;
                }

                const dateString = formatLocalDate(date);
                data.push((focusData[dateString]?.totalMinutes || 0) / 60);
            }

            return data;
        }

        function prepareRestDurationData(startDate, endDate, labels) {
            const data = [];

            for (let i = 0; i < labels.length; i++) {
                const date = new Date(startDate);
                if (labels.length === 7) {
                    date.setDate(startDate.getDate() + i);
                } else if (labels.length === 10) {
                    date.setDate(startDate.getDate() + i * 3);
                } else if (labels.length === 12) {
                    date.setMonth(startDate.getMonth() + i);

                    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
                    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
                    let monthTotal = 0;

                    const monthCurrent = new Date(monthStart);
                    while (monthCurrent <= monthEnd) {
                        const monthDateString = formatLocalDate(monthCurrent);
                        if (restData[monthDateString]) {
                            monthTotal += restData[monthDateString].totalMinutes || 0;
                        }
                        monthCurrent.setDate(monthCurrent.getDate() + 1);
                    }

                    data.push(monthTotal / 60);
                    continue;
                }

                const dateString = formatLocalDate(date);
                data.push((restData[dateString]?.totalMinutes || 0) / 60);
            }

            return data;
        }
        
        // 更新打卡率图表
        function updateCheckinRateChart(labels, data) {
            updateChartInstance('checkinRateChart', 'checkin-rate-chart', {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '打卡合格率 (%)',
                        data: data,
                        borderColor: '#1a56db',
                        backgroundColor: 'rgba(26, 86, 219, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            ticks: {
                                callback: function(value) {
                                    return value + '%';
                                }
                            }
                        }
                    }
                }
            });
        }
        
        // 更新时段打卡图表
        function updateCheckinPeriodChart(data) {
            updateChartInstance('checkinPeriodChart', 'checkin-period-chart', {
                type: 'bar',
                data: {
                    labels: ['上午', '下午', '晚上'],
                    datasets: [
                        {
                            label: '打卡次数',
                            data: [
                                data.morning.checkIn + data.morning.checkOut,
                                data.afternoon.checkIn + data.afternoon.checkOut,
                                data.evening.checkIn + data.evening.checkOut
                            ],
                            backgroundColor: 'rgba(26, 86, 219, 0.7)',
                            borderColor: 'rgba(26, 86, 219, 1)',
                            borderWidth: 1
                        },
                        {
                            label: '合格次数',
                            data: [
                                data.morning.qualifiedCheckIn + data.morning.qualifiedCheckOut,
                                data.afternoon.qualifiedCheckIn + data.afternoon.qualifiedCheckOut,
                                data.evening.qualifiedCheckIn + data.evening.qualifiedCheckOut
                            ],
                            backgroundColor: 'rgba(16, 185, 129, 0.7)',
                            borderColor: 'rgba(16, 185, 129, 1)',
                            borderWidth: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true
                        }
                    }
                }
            });
        }
        
        // 更新任务时长图表
        function updateTaskDurationChart(labels, data) {
            updateChartInstance('taskDurationChart', 'task-duration-chart', {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '任务时长 (小时)',
                        data: data,
                        backgroundColor: 'rgba(79, 70, 229, 0.7)',
                        borderColor: 'rgba(79, 70, 229, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true
                        }
                    }
                }
            });
        }
        
        // 更新手机克制图表
        function updatePhoneResistChart(labels, data) {
            updateChartInstance('phoneResistChart', 'phone-resist-chart', {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '克制次数',
                        data: data,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true
                        }
                    }
                }
            });
        }

        function updateFocusDurationChart(labels, data) {
            updateChartInstance('focusDurationChart', 'focus-duration-chart', {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '专注时长 (小时)',
                        data: data,
                        backgroundColor: 'rgba(59, 130, 246, 0.7)',
                        borderColor: 'rgba(59, 130, 246, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true
                        }
                    }
                }
            });
        }

        function updateRestDurationChart(labels, data) {
            updateChartInstance('restDurationChart', 'rest-duration-chart', {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '休息时长 (小时)',
                        data: data,
                        backgroundColor: 'rgba(16, 185, 129, 0.7)',
                        borderColor: 'rgba(16, 185, 129, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true
                        }
                    }
                }
            });
        }
        
        // 更新综合统计
        function updateSummaryStatistics() {
            // 总打卡天数
            const totalCheckinDays = Object.keys(checkinData).filter(date => {
                const dayData = checkinData[date];
                return !dayData.leave && (dayData.morning.checkIn || dayData.afternoon.checkIn || dayData.evening.checkIn);
            }).length;
            getElement('total-checkin-days').textContent = totalCheckinDays;
            
            // 总任务时长(小时)
            const totalTaskHours = calculateTotalTaskHours();
            getElement('total-task-hours').textContent = totalTaskHours;
            
            // 总克制次数
            getElement('total-phone-resist').textContent = phoneResistData.totalCount;

            // 总专注时长(小时)
            const totalFocusMinutes = Object.values(focusData).reduce((sum, day) => sum + (day.totalMinutes || 0), 0);
            getElement('total-focus-hours').textContent = Math.floor(totalFocusMinutes / 60);

            // 总休息时长(小时)
            const totalRestMinutes = Object.values(restData).reduce((sum, day) => sum + (day.totalMinutes || 0), 0);
            getElement('total-rest-hours').textContent = Math.floor(totalRestMinutes / 60);
            
            // 获得成就数
            getElement('achievement-count').textContent = achievements.length;
        }
        
        // 更新今日状态
        function updateTodayStatus() {
            const workDay = getWorkDayString();
            const today = getTodayString();
            ensureDateData(workDay);
            ensureDateData(today);
            const dayData = checkinData[workDay];
            
            // 上午打卡状态
            const morningStatus = getElement('today-morning-status');
            if (dayData.leave) {
                morningStatus.textContent = '请假';
                morningStatus.className = 'font-medium text-gray-500';
            } else if (dayData.morning.checkIn && dayData.morning.checkOut) {
                const checkInOk = dayData.morning.status.checkIn;
                const checkOutOk = dayData.morning.status.checkOut;
                
                if (checkInOk && checkOutOk) {
                    morningStatus.textContent = '合格';
                    morningStatus.className = 'font-medium text-green-600';
                } else {
                    morningStatus.textContent = '不合格';
                    morningStatus.className = 'font-medium text-red-600';
                }
            } else if (dayData.morning.checkIn) {
                morningStatus.textContent = '已上班';
                morningStatus.className = 'font-medium text-blue-600';
            } else {
                morningStatus.textContent = '-';
                morningStatus.className = 'font-medium';
            }
            
            // 下午打卡状态
            const afternoonStatus = getElement('today-afternoon-status');
            if (dayData.leave) {
                afternoonStatus.textContent = '请假';
                afternoonStatus.className = 'font-medium text-gray-500';
            } else if (dayData.afternoon.checkIn && dayData.afternoon.checkOut) {
                const checkInOk = dayData.afternoon.status.checkIn;
                const checkOutOk = dayData.afternoon.status.checkOut;
                
                if (checkInOk && checkOutOk) {
                    afternoonStatus.textContent = '合格';
                    afternoonStatus.className = 'font-medium text-green-600';
                } else {
                    afternoonStatus.textContent = '不合格';
                    afternoonStatus.className = 'font-medium text-red-600';
                }
            } else if (dayData.afternoon.checkIn) {
                afternoonStatus.textContent = '已上班';
                afternoonStatus.className = 'font-medium text-blue-600';
            } else {
                afternoonStatus.textContent = '-';
                afternoonStatus.className = 'font-medium';
            }
            
            // 晚上打卡状态
            const eveningStatus = getElement('today-evening-status');
            if (dayData.leave) {
                eveningStatus.textContent = '请假';
                eveningStatus.className = 'font-medium text-gray-500';
            } else if (dayData.evening.checkIn && dayData.evening.checkOut) {
                const checkInOk = dayData.evening.status.checkIn;
                const checkOutOk = dayData.evening.status.checkOut;
                
                if (checkInOk && checkOutOk) {
                    eveningStatus.textContent = '合格';
                    eveningStatus.className = 'font-medium text-green-600';
                } else {
                    eveningStatus.textContent = '不合格';
                    eveningStatus.className = 'font-medium text-red-600';
                }
            } else if (dayData.evening.checkIn) {
                eveningStatus.textContent = '已上班';
                eveningStatus.className = 'font-medium text-blue-600';
            } else {
                eveningStatus.textContent = '-';
                eveningStatus.className = 'font-medium';
            }
            
            // 手机克制次数
            getElement('today-phone-count').textContent = `${phoneResistData.records[today].count} 次`;
            
            // 进行中任务
            const activeTaskElement = getElement('today-active-task');
            if (currentTask) {
                activeTaskElement.textContent = currentTask.name;
                activeTaskElement.className = 'font-medium text-blue-600';
            } else {
                activeTaskElement.textContent = '-';
                activeTaskElement.className = 'font-medium';
            }

            // 今日专注时长
            getElement('today-focus-duration').textContent = `${focusData[today].totalMinutes} 分钟`;
            updateCatCompanion();
        }
