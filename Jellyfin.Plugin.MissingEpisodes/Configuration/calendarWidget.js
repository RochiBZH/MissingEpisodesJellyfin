(function () {
    'use strict';

    var BUTTON_ID = 'me-user-calendar-button';
    var FLOATING_BUTTON_ID = 'me-user-calendar-floating-button';
    var OVERLAY_ID = 'me-user-calendar-overlay';
    var DATA_ENDPOINT = 'Plugins/MissingEpisodes/calendar';
    var state = { data: null, isAdministrator: false, scope: 'active', type: 'all', query: '', previousOverflow: '' };

    function value(object, name) {
        if (!object) return undefined;
        if (object[name] !== undefined) return object[name];
        return object[name.charAt(0).toLowerCase() + name.slice(1)];
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
        });
    }

    function currentApiClient() {
        if (window.ApiClient && typeof window.ApiClient.ajax === 'function') return window.ApiClient;
        var manager = window.connectionManager;
        if (manager && typeof manager.currentApiClient === 'function') {
            var api = manager.currentApiClient();
            if (api && typeof api.ajax === 'function') return api;
        }
        return null;
    }

    function credentialsFromApi(api) {
        if (!api) return null;
        var token = typeof api.accessToken === 'function' ? api.accessToken() : api._accessToken;
        var userId = typeof api.getCurrentUserId === 'function' ? api.getCurrentUserId()
            : (api._currentUser && api._currentUser.Id) || api.currentUserId;
        return token ? { token: token, userId: userId || null } : null;
    }

    function getCredentials() {
        var credentials = credentialsFromApi(window.ApiClient);
        if (credentials && credentials.userId) return credentials;

        var manager = window.connectionManager;
        if (manager && typeof manager.currentApiClient === 'function') {
            credentials = credentialsFromApi(manager.currentApiClient());
            if (credentials && credentials.userId) return credentials;
        }

        try {
            var stored = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            var servers = stored.Servers || stored.servers || [];
            var origin = window.location.origin;
            var currentToken = credentials && credentials.token;
            for (var i = 0; i < servers.length; i++) {
                var server = servers[i];
                var address = server.LocalAddress || server.ManualAddress || server.RemoteAddress || '';
                var token = server.AccessToken || server.accessToken;
                if (address.indexOf(origin) !== -1 && token
                    && (!currentToken || token === currentToken)) {
                    return { token: token, userId: server.UserId || server.userId || null };
                }
            }
            if (credentials && credentials.token) return credentials;
            for (var j = 0; j < servers.length; j++) {
                var fallback = servers[j];
                var fallbackToken = fallback.AccessToken || fallback.accessToken;
                if (fallbackToken) {
                    return { token: fallbackToken, userId: fallback.UserId || fallback.userId || null };
                }
            }
        } catch (e) {}
        return credentials;
    }

    function hasUserSession() {
        var credentials = getCredentials();
        return !!(credentials && credentials.token && credentials.userId);
    }

    function fetchCalendar() {
        var api = currentApiClient();
        if (api) {
            return api.ajax({
                type: 'GET',
                url: api.getUrl(DATA_ENDPOINT),
                dataType: 'json'
            });
        }

        var credentials = getCredentials();
        if (!credentials || !credentials.token) return Promise.reject(new Error('Jellyfin session is not ready.'));
        var path = window.location.pathname || '/';
        var webIndex = path.toLowerCase().indexOf('/web');
        var basePath = webIndex >= 0 ? path.substring(0, webIndex + 1) : '/';
        return fetch(basePath + DATA_ENDPOINT, {
            headers: { Authorization: 'MediaBrowser Token="' + credentials.token + '"' }
        }).then(function (response) {
            if (!response.ok) throw new Error('Calendar request failed.');
            return response.json();
        });
    }

    function installStyles() {
        if (document.getElementById('me-user-calendar-styles')) return;
        var style = document.createElement('style');
        style.id = 'me-user-calendar-styles';
        style.textContent = [
            '#me-user-calendar-overlay{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.78);color:#ebedf0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}',
            '.meuc-floating-button{position:fixed!important;right:24px!important;bottom:24px!important;z-index:2147483647!important;display:block!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;padding:9px 17px!important;border:1px solid rgba(255,255,255,.22)!important;border-radius:24px!important;background:rgba(10,10,10,.93)!important;backdrop-filter:blur(10px)!important;box-shadow:0 4px 24px rgba(0,0,0,.65)!important;color:#fff!important;font:600 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif!important;cursor:pointer!important;user-select:none!important;white-space:nowrap!important;transition:background .2s,transform .15s!important}',
            '.meuc-floating-button:hover{background:rgba(30,30,30,.98)!important;transform:scale(1.05)!important}',
            '.meuc-floating-button:focus-visible{outline:2px solid #e5706e!important;outline-offset:3px!important}',
            '#me-user-calendar-overlay.meuc-open{display:flex}',
            '#me-user-calendar-overlay *{box-sizing:border-box}',
            '.meuc-panel{width:min(1180px,100%);height:min(92vh,900px);display:flex;flex-direction:column;overflow:hidden;background:#111318;border:1px solid rgba(255,255,255,.14);border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.6)}',
            '.meuc-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.1)}',
            '.meuc-title{font-size:18px;font-weight:650;color:#f5f5f7}',
            '.meuc-close{width:36px;height:36px;border:0;border-radius:8px;background:transparent;color:#ddd;font-size:24px;cursor:pointer}',
            '.meuc-close:hover{background:rgba(255,255,255,.1)}',
            '.meuc-filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid rgba(255,255,255,.1)}',
            '.meuc-filters select,.meuc-filters input{height:38px;min-width:120px;padding:0 10px;border:1px solid rgba(255,255,255,.16);border-radius:7px;background:#1b1e25;color:#eee;font:inherit}',
            '.meuc-filters input{flex:1;min-width:160px}',
            '.meuc-content{flex:1;overflow:auto;padding:16px 18px 24px}',
            '.meuc-section{margin:0 0 12px;overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:#15171d}',
            '.meuc-section-toggle{display:flex;width:100%;align-items:center;gap:9px;padding:12px 14px;border:0;background:transparent;color:#8da4d0;text-align:left;font:inherit;cursor:pointer}',
            '.meuc-section-toggle:focus-visible{outline:2px solid #e5706e;outline-offset:-2px}',
            '.meuc-section-title{margin:0;font-size:13px;font-weight:650}',
            '.meuc-section-count{color:rgba(235,237,240,.52);font-size:12px}',
            '.meuc-section-chevron{width:14px;height:14px;flex:0 0 auto;transition:transform .18s}',
            '.meuc-section.open .meuc-section-chevron{transform:rotate(90deg)}',
            '.meuc-section-body{display:none;padding:0 12px 12px}',
            '.meuc-section.open .meuc-section-body{display:block}',
            '.meuc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}',
            '.meuc-card{min-width:0;overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:#191b21}',
            '.meuc-poster{position:relative;width:100%;aspect-ratio:2/3;background:#20232a center/cover no-repeat}',
            '.meuc-date{position:absolute;top:7px;right:7px;max-width:calc(100% - 14px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 6px;border-radius:999px;background:#e5706e;color:#fff;font-size:10px;font-weight:650}',
            '.meuc-c411{position:absolute;z-index:3;top:7px;left:7px;display:inline-flex;align-items:center;justify-content:center;padding:4px 7px;border:1px solid #1a7e3e;border-radius:6px;background:#1a7e3e;color:#fff;text-decoration:none;font-size:10px;font-weight:700}',
            '.meuc-c411:focus-visible{outline:2px solid #e5706e;outline-offset:2px}',
            '.meuc-card-meta{padding:8px 9px 10px}',
            '.meuc-card-title{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:#f2f2f4;font-size:13px;font-weight:650;line-height:1.25}',
            '.meuc-card-episodes{margin-top:5px;color:rgba(235,237,240,.65);font-size:11px;line-height:1.35}',
            '.meuc-card-episodes strong{color:#f2f2f4;font-weight:750}',
            '.meuc-empty,.meuc-loading,.meuc-error{padding:48px 16px;text-align:center;color:rgba(235,237,240,.68)}',
            '.meuc-error{color:#f28b82}',
            '@media(max-width:720px){.meuc-floating-button{right:16px;bottom:calc(16px + env(safe-area-inset-bottom))}#me-user-calendar-overlay{padding:0}.meuc-panel{width:100%;height:100%;max-height:none;border:0;border-radius:0}.meuc-header{padding:12px 14px}.meuc-filters{gap:7px;padding:10px 12px}.meuc-filters select{flex:1;min-width:0}.meuc-filters input{flex:1 0 100%;min-width:0}.meuc-content{padding:12px}.meuc-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.meuc-card-meta{padding:6px}.meuc-card-title{font-size:11px}.meuc-card-episodes{font-size:9px}.meuc-date{top:4px;right:4px;max-width:calc(100% - 8px);padding:3px 4px;font-size:8px}}'
        ].join('');
        document.head.appendChild(style);
    }

    function createOverlay() {
        var overlay = document.getElementById(OVERLAY_ID);
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.setAttribute('role', 'presentation');
        overlay.innerHTML = '<section class="meuc-panel" role="dialog" aria-modal="true" aria-labelledby="meuc-title">'
            + '<header class="meuc-header"><div class="meuc-title" id="meuc-title">Episode calendar</div>'
            + '<button class="meuc-close" type="button" aria-label="Close calendar">&times;</button></header>'
            + '<div class="meuc-filters">'
            + '<select class="meuc-scope" aria-label="Show scope"><option value="active">Active</option><option value="ignored">Ignored</option></select>'
            + '<select class="meuc-type" aria-label="Series type"><option value="all">All types</option><option value="standard">TV</option><option value="anime">Anime</option></select>'
            + '<input class="meuc-search" type="search" placeholder="Filter series" aria-label="Filter series">'
            + '</div><main class="meuc-content"><div class="meuc-loading">Loading calendar...</div></main></section>';
        document.body.appendChild(overlay);

        overlay.querySelector('.meuc-close').addEventListener('click', closeOverlay);
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closeOverlay();
        });
        overlay.querySelector('.meuc-scope').addEventListener('change', function (event) {
            state.scope = event.target.value;
            renderCalendar();
        });
        overlay.querySelector('.meuc-type').addEventListener('change', function (event) {
            state.type = event.target.value;
            renderCalendar();
        });
        overlay.querySelector('.meuc-search').addEventListener('input', function (event) {
            state.query = event.target.value || '';
            renderCalendar();
        });
        return overlay;
    }

    function closeOverlay() {
        var overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) return;
        overlay.classList.remove('meuc-open');
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
    }

    function openOverlay() {
        var overlay = createOverlay();
        overlay.classList.add('meuc-open');
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        overlay.querySelector('.meuc-close').focus();
        overlay.querySelector('.meuc-content').innerHTML = '<div class="meuc-loading">Loading calendar...</div>';
        fetchCalendar().then(function (data) {
            state.data = data || { Series: [], IgnoredSeries: [] };
            renderCalendar();
        }).catch(function () {
            overlay.querySelector('.meuc-content').innerHTML = '<div class="meuc-error">Unable to load the calendar.</div>';
        });
    }

    function getField(object, name) {
        if (!object) return undefined;
        if (object[name] !== undefined) return object[name];
        return object[name.charAt(0).toLowerCase() + name.slice(1)];
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
        });
    }

    function airDateLocal(value) {
        var date = new Date(value);
        if (isNaN(date.getTime())) return null;
        return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }

    function addDays(date, count) {
        var result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        result.setDate(result.getDate() + count);
        return result;
    }

    function pad2(number) {
        return number < 10 ? '0' + number : String(number);
    }

    function getEpisodes(seriesList) {
        var episodes = [];
        (seriesList || []).forEach(function (series) {
            (getField(series, 'Missing') || []).forEach(function (episode) {
                var date = airDateLocal(getField(episode, 'AirDateUtc'));
                if (!date) return;
                episodes.push({
                    series: series,
                    seasonNumber: getField(episode, 'SeasonNumber'),
                    episodeNumber: getField(episode, 'EpisodeNumber'),
                    title: getField(episode, 'Title'),
                    date: date
                });
            });
        });
        episodes.sort(function (a, b) { return a.date - b.date; });
        return episodes;
    }

    function groupByDate(episodes) {
        var today = new Date();
        today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        var tomorrow = addDays(today, 1);
        var dayOfWeek = (today.getDay() + 6) % 7;
        var nextWeekStart = addDays(today, 7 - dayOfWeek);
        var weekAfterStart = addDays(nextWeekStart, 7);
        var groups = { released: [], tomorrow: [], week: [], next: [], months: [] };
        var monthIndex = {};

        episodes.forEach(function (episode) {
            var time = episode.date.getTime();
            if (time < tomorrow.getTime()) groups.released.push(episode);
            else if (time === tomorrow.getTime()) groups.tomorrow.push(episode);
            else if (time < nextWeekStart.getTime()) groups.week.push(episode);
            else if (time < weekAfterStart.getTime()) groups.next.push(episode);
            else {
                var monthKey = episode.date.getFullYear() + '-' + pad2(episode.date.getMonth() + 1);
                if (!monthIndex[monthKey]) {
                    var label = episode.date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
                    label = label.charAt(0).toUpperCase() + label.slice(1);
                    monthIndex[monthKey] = { key: 'month-' + monthKey, label: label, list: [] };
                    groups.months.push(monthIndex[monthKey]);
                }
                monthIndex[monthKey].list.push(episode);
            }
        });
        groups.released.reverse();
        return groups;
    }

    function groupBySeriesAndSeason(episodes) {
        var groups = [];
        var index = Object.create(null);
        episodes.forEach(function (episode) {
            var series = episode.series;
            var key = (getField(series, 'TvdbId') || getField(series, 'TmdbId')
                || getField(series, 'JellyfinSeriesId') || getField(series, 'Title'))
                + ':' + episode.seasonNumber;
            if (!index[key]) {
                index[key] = { series: series, seasonNumber: episode.seasonNumber, episodes: [] };
                groups.push(index[key]);
            }
            index[key].episodes.push(episode);
        });
        groups.forEach(function (group) {
            group.episodes.sort(function (a, b) { return a.date - b.date; });
        });
        return groups;
    }

    function formatEpisodeLine(group) {
        var series = group.series;
        var seasons = getField(series, 'Seasons') || [];
        var summary = seasons.find(function (season) {
            return getField(season, 'SeasonNumber') === group.seasonNumber;
        });
        var complete = summary && getField(summary, 'TotalEpisodes') > 0
            && group.episodes.length === getField(summary, 'TotalEpisodes');
        if (complete) {
            return group.seasonNumber === 0
                ? '<strong>Specials</strong> complete'
                : '<strong>Season ' + group.seasonNumber + '</strong> complete';
        }
        var episodeNumbers = group.episodes.map(function (episode) {
            return episode.episodeNumber;
        }).sort(function (a, b) { return a - b; });
        var numbers = episodeNumbers.length > 4
            ? episodeNumbers.length + ' eps · E' + pad2(episodeNumbers[0])
                + ' - E' + pad2(episodeNumbers[episodeNumbers.length - 1])
            : episodeNumbers.map(function (number) { return 'E' + pad2(number); }).join(', ');
        return '<strong>S' + pad2(group.seasonNumber) + '</strong> · ' + numbers;
    }

    function posterUrl(series) {
        var raw = getField(series, 'PosterUrl') || '';
        if (raw.indexOf('jellyfin:') !== 0 || !currentApiClient()) return '';
        return currentApiClient().getScaledImageUrl(raw.substring('jellyfin:'.length), {
            type: 'Primary', quality: 75, maxWidth: 360
        });
    }

    function renderCalendar() {
        var overlay = document.getElementById(OVERLAY_ID);
        if (!overlay || !state.data) return;
        var data = state.data;
        var seriesList = getField(data, state.scope === 'ignored' ? 'IgnoredSeries' : 'Series') || [];
        var query = state.query.trim().toLowerCase();
        seriesList = seriesList.filter(function (series) {
            var type = (getField(series, 'SeriesType') || 'standard').toLowerCase();
            if (state.type === 'anime' && type !== 'anime') return false;
            if (state.type === 'standard' && type === 'anime') return false;
            return !query || (getField(series, 'Title') || '').toLowerCase().indexOf(query) !== -1;
        });

        var groups = groupByDate(getEpisodes(seriesList));
        var sections = [
            { key: 'released', label: 'D\u00e9j\u00e0 sortis', episodes: groups.released },
            { key: 'tomorrow', label: 'Demain', episodes: groups.tomorrow },
            { key: 'week', label: 'Cette semaine', episodes: groups.week },
            { key: 'next', label: 'La semaine prochaine', episodes: groups.next }
        ].concat(groups.months.map(function (month) {
            return { key: month.key, label: month.label, episodes: month.list };
        }));

        var html = sections.map(function (section) {
            if (!section.episodes.length) return '';
            var cardGroups = groupBySeriesAndSeason(section.episodes);
            if (section.key === 'released') {
                cardGroups.sort(function (a, b) {
                    return (getField(a.series, 'Title') || '').localeCompare(getField(b.series, 'Title') || '')
                        || a.seasonNumber - b.seasonNumber;
                });
            }
            var cards = cardGroups.map(function (group) {
                var series = group.series;
                var episodes = group.episodes;
                var firstDate = episodes[0].date;
                var lastDate = episodes[episodes.length - 1].date;
                var dateText;
                if (episodes.length === 1) {
                    dateText = firstDate.toLocaleDateString('fr-FR', {
                        weekday: 'short', day: 'numeric', month: 'short'
                    });
                } else {
                    var firstText = firstDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
                    var lastText = lastDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
                    dateText = firstText === lastText ? firstText : firstText + ' - ' + lastText;
                }
                var title = getField(series, 'Title') || '';
                var searchUrl = 'https://c411.org/torrents?q='
                    + encodeURIComponent(title).replace(/%20/g, '+') + '&sortBy=relevance';
                var c411Link = state.isAdministrator
                    ? '<a class="meuc-c411" href="' + escapeHtml(searchUrl) + '" target="_blank" rel="noopener noreferrer" aria-label="Search '
                        + escapeHtml(title) + ' on c411" title="Search on c411">C411</a>'
                    : '';
                var typeTag = (getField(series, 'SeriesType') || '').toLowerCase() === 'anime'
                    ? '<span class="meuc-anime">Anime</span>' : '';
                var image = posterUrl(series);
                var imageAttribute = image ? ' data-image="' + escapeHtml(image) + '"' : '';
                var placeholder = image ? '' : '<span class="meuc-placeholder">' + escapeHtml(title) + '</span>';
                return '<article class="meuc-card">'
                    + '<div class="meuc-poster"' + imageAttribute + '>' + c411Link + '<span class="meuc-date">' + escapeHtml(dateText) + '</span>' + placeholder + '</div>'
                    + '<div class="meuc-card-meta"><div class="meuc-card-title">' + escapeHtml(title) + typeTag + '</div>'
                    + '<div class="meuc-card-episodes">' + formatEpisodeLine(group) + '</div></div></article>';
            }).join('');
            var isOpen = section.key !== 'released';
            var bodyId = 'meuc-' + section.key + '-body';
            return '<section class="meuc-section' + (isOpen ? ' open' : '') + '">'
                + '<button class="meuc-section-toggle" type="button" aria-expanded="' + (isOpen ? 'true' : 'false')
                + '" aria-controls="' + bodyId + '">'
                + '<svg class="meuc-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'
                + '<span class="meuc-section-title">' + escapeHtml(section.label) + '</span>'
                + '<span class="meuc-section-count">· ' + section.episodes.length + '</span></button>'
                + '<div class="meuc-section-body" id="' + bodyId + '"><div class="meuc-grid">'
                + cards + '</div></div></section>';
        }).join('');

        var content = overlay.querySelector('.meuc-content');
        content.innerHTML = html || '<div class="meuc-empty">No episodes match these filters.</div>';
        content.querySelectorAll('.meuc-section-toggle').forEach(function (toggle) {
            toggle.addEventListener('click', function () {
                var section = toggle.closest('.meuc-section');
                var isOpen = section.classList.toggle('open');
                toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            });
        });
        content.querySelectorAll('.meuc-poster[data-image]').forEach(function (poster) {
            poster.style.backgroundImage = 'url(' + JSON.stringify(poster.getAttribute('data-image')) + ')';
        });
    }

    function removeMenuButton() {
        var button = document.getElementById(BUTTON_ID);
        if (button) button.remove();
    }

    function isSeriesCollectionPage() {
        return /^#!?\/tv(?:\?.*)?$/i.test(window.location.hash || '');
    }

    function syncFloatingButton() {
        removeMenuButton();
        if (!hasUserSession() || !isSeriesCollectionPage()) {
            var existing = document.getElementById(FLOATING_BUTTON_ID);
            if (existing) existing.remove();
            return;
        }
        if (document.getElementById(FLOATING_BUTTON_ID)) return;
        var button = document.createElement('button');
        button.id = FLOATING_BUTTON_ID;
        button.type = 'button';
        button.className = 'meuc-floating-button';
        button.textContent = 'Calendar';
        button.setAttribute('aria-label', 'Open episode calendar');
        button.addEventListener('click', openOverlay);
        document.body.appendChild(button);
    }

    function hasUserSession() {
        var api = currentApiClient();
        if (!api) return false;
        var token = typeof api.accessToken === 'function' ? api.accessToken() : api._accessToken;
        var userId = typeof api.getCurrentUserId === 'function' ? api.getCurrentUserId() : null;
        return !!(token && userId);
    }

    function openOverlay() {
        installStyles();
        var overlay = createOverlay();
        overlay.classList.add('meuc-open');
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        overlay.querySelector('.meuc-close').focus();
        overlay.querySelector('.meuc-content').innerHTML = '<div class="meuc-loading">Loading calendar...</div>';
        fetchCalendar().then(function (data) {
            state.data = data || { Series: [], IgnoredSeries: [] };
            state.isAdministrator = !!getField(data, 'IsAdministrator');
            renderCalendar();
        }).catch(function () {
            overlay.querySelector('.meuc-content').innerHTML = '<div class="meuc-error">Unable to load the calendar.</div>';
        });
    }

    function start() {
        installStyles();
        syncFloatingButton();
        window.addEventListener('hashchange', syncFloatingButton);
        document.addEventListener('viewshow', syncFloatingButton);
        window.setInterval(syncFloatingButton, 800);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
