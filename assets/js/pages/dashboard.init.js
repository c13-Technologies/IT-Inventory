// dashboard.init.js — fetches /api/dashboard/stats + /api/dashboard/trends
// and renders ApexCharts (bar, donut, sparklines) plus a recent activity feed.
// On failure each stat card swaps its "--" placeholder for a visible
// "Failed" indicator and a top-level banner shows a Retry button. Sparklines
// distinguish a real empty 7-day window from a fetch failure by switching
// the container content to a red "Failed" badge. A generation counter
// guards against stale-fetch races when the user clicks Retry rapidly.
(function () {
  'use strict';

  function getChartColorsArray(el) {
    var data = el.getAttribute("data-colors");
    if (!data) return ["#5156be"];
    try {
      return JSON.parse(data).map(function (c) {
        c = c.replace(" ", "");
        if (c.indexOf("--") === -1) return c;
        var v = getComputedStyle(document.documentElement).getPropertyValue(c);
        return v || c;
      });
    } catch (e) {
      return ["#5156be"];
    }
  }

  // Mini sparkline — 7-day area chart. Clears the container first so it
  // can recover cleanly from a prior "Failed" badge state. Height matches
  // the template (style="height: 38px" on each spark-card div); kept
  // hardcoded here so a CSS-class change to the template can't silently
  // break the chart.
  function renderSparkline(elId, data, color) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = '';
    var chart = new ApexCharts(el, {
      chart: {
        type: 'area',
        height: 38,
        sparkline: { enabled: true },
        animations: { enabled: true, speed: 400 }
      },
      series: [{ name: elId, data: data }],
      stroke: { curve: 'smooth', width: 2 },
      fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 100] } },
      colors: [color],
      tooltip: {
        enabled: true,
        fixed: { enabled: false },
        x: { show: false },
        y: { formatter: function (v) { return v + ' added'; } },
        marker: { show: false }
      }
    });
    chart.render();
  }

  // Replace a sparkline container with a "Failed" indicator so users can
  // distinguish a real empty 7-day window from a fetch failure.
  function showSparklineError(elId) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = '<div class="d-flex h-100 align-items-center justify-content-center text-danger font-size-11"><i class="mdi mdi-alert-circle-outline me-1"></i>Failed</div>';
  }

  // Set a stat card number area to one of: 'loading' | 'ok' | 'error'.
  //   'loading' -> muted spinner, no value
  //   'ok'      -> plain textContent of value
  //   'error'   -> red "Failed" with the error message as a tooltip
  function setStatState(id, state, value) {
    var el = document.getElementById(id);
    if (!el) return;
    if (state === 'loading') {
      el.innerHTML = '<span class="text-muted font-size-18"><i class="mdi mdi-loading mdi-spin"></i></span>';
    } else if (state === 'error') {
      el.innerHTML = '<span class="text-danger font-size-14" title="' + escapeHtml(value || 'Failed to load') + '"><i class="mdi mdi-alert-circle-outline me-1"></i>Failed</span>';
    } else {
      el.textContent = value != null ? value : 0;
    }
  }

  // Show or hide the global dashboard error banner above the stat row.
  function setBanner(state, detail) {
    var banner = document.getElementById('dashboard-error-banner');
    if (!banner) return;
    if (state === 'error') {
      banner.classList.remove('d-none');
      var d = document.getElementById('dashboard-error-detail');
      if (d) d.textContent = detail || 'Some metrics may be unavailable.';
    } else {
      banner.classList.add('d-none');
    }
  }

  // Enable/disable the Retry button while a fetch is in flight.
  function setRetryDisabled(disabled) {
    var btn = document.getElementById('dashboard-retry-btn');
    if (!btn) return;
    btn.disabled = !!disabled;
  }

  // Module-scope helpers — hoisted so they're defined once and reused
  // by both the failure and success branches of the Promise chain.
  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  function setWidth(id, val) {
    var el = document.getElementById(id);
    if (el) el.style.width = val;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Format the entity type + truncated ID for display
  function formatEntity(entry) {
    var type = entry.entityType || 'unknown';
    var id = entry.entityId || '';
    var short = id.length > 12 ? id.substring(0, 12) + '...' : id;
    return type + ' ' + short;
  }

  // Action badge colours
  function actionBadge(action) {
    if (!action) return 'bg-secondary';
    if (action.indexOf('create') !== -1) return 'bg-success';
    if (action.indexOf('update') !== -1) return 'bg-primary';
    if (action.indexOf('delete') !== -1) return 'bg-danger';
    return 'bg-secondary';
  }

  // Action icon
  function actionIcon(action) {
    if (!action) return 'mdi mdi-dots-horizontal';
    if (action.indexOf('create') !== -1) return 'mdi mdi-plus-circle';
    if (action.indexOf('update') !== -1) return 'mdi mdi-pencil-circle';
    if (action.indexOf('delete') !== -1) return 'mdi mdi-delete-circle';
    return 'mdi mdi-dots-horizontal';
  }

  // Render the recent activity feed.
  //   activity = array -> normal render
  //   error = true     -> show a single failed-state row
  //   empty array      -> "No recent activity" row
  function renderActivity(activity, error) {
    var list = document.getElementById('recent-activity-list');
    if (!list) return;
    if (error) {
      list.innerHTML = '<li class="activity-list activity-border text-center text-danger py-3"><i class="mdi mdi-alert-circle-outline me-1"></i>Failed to load activity.</li>';
      return;
    }
    if (!activity || activity.length === 0) {
      list.innerHTML = '<li class="activity-list activity-border text-center text-muted py-4">No recent activity.</li>';
      return;
    }
    var html = '';
    activity.forEach(function (entry) {
      var when = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
      html += '<li class="activity-list activity-border">';
      html += '<div class="activity-icon avatar-sm">';
      html += '<span class="avatar-title rounded-circle bg-' + (actionBadge(entry.action).replace('bg-', '') + '-subtle') + ' text-' + actionBadge(entry.action).replace('bg-', '') + ' font-size-18">';
      html += '<i class="' + actionIcon(entry.action) + '"></i>';
      html += '</span></div>';
      html += '<div class="timeline-list-item">';
      html += '<div class="d-flex">';
      html += '<div class="flex-grow-1 overflow-hidden me-4">';
      html += '<h5 class="font-size-14 mb-1">' + when + '</h5>';
      html += '<p class="text-truncate text-muted font-size-13">' + escapeHtml(entry.userName) + ' — ' + escapeHtml(formatEntity(entry)) + '</p>';
      html += '</div>';
      html += '<div class="flex-shrink-0 text-end">';
      html += '<span class="badge ' + actionBadge(entry.action) + ' font-size-12">' + escapeHtml(entry.action) + '</span>';
      html += '</div>';
      html += '</div></div></li>';
    });
    list.innerHTML = html;
  }

  // Status display labels
  var STATUS_LABELS = {
    IN_STOCK: 'In Stock',
    ASSIGNED: 'Assigned',
    IN_REPAIR: 'In Repair',
    RETIRED: 'Retired',
    LOST: 'Lost'
  };

  // Sparkline palette — mirrors each card's data-colors attribute so the
  // mini-chart and the bar/donut share the same accent.
  var SPARK_COLOR = {
    'sparkline-assets':      '#5156be',
    'sparkline-assignments': '#34c38f',
    'sparkline-users':       '#50a5f1',
    'sparkline-vendors':     '#f1b44c'
  };

  // Single source of truth for the 5 stat h4 ids and 4 sparkline ids.
  var STAT_IDS = ['stat-total-assets', 'stat-assigned', 'stat-users', 'stat-vendors', 'stat-locations'];
  var SPARK_IDS = ['sparkline-assets', 'sparkline-assignments', 'sparkline-users', 'sparkline-vendors'];

  // Reset every stat card to "Loading…" and hide the error banner.
  function resetStatStates() {
    STAT_IDS.forEach(function (id) { setStatState(id, 'loading'); });
    setText('qs-in-repair', '--');
    setText('qs-retired', '--');
    setText('qs-instock', '--');
    setWidth('qs-bar-inrepair', '0%');
    setWidth('qs-bar-retired', '0%');
    setWidth('qs-bar-instock', '0%');
    ['sparkline-assets-total', 'sparkline-assignments-total', 'sparkline-users-total'].forEach(function (id) {
      setText(id, '-- in 7d');
    });
    setText('sparkline-vendors-total', '-- new in 7d');
    setBanner('ok');
  }

  // Generation counter — increments on every loadDashboard() call so stale
  // .then() callbacks from a previous, aborted fetch can early-return.
  // Prevents the "click Retry fast" race where a late response overwrites
  // fresh data with an error state (or vice versa).
  var requestGen = 0;

  function loadDashboard() {
    var myGen = ++requestGen;
    setRetryDisabled(true);
    resetStatStates();

    Promise.allSettled([
      fetch('/api/dashboard/stats',  { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('stats HTTP ' + r.status); return r.json(); }),
      fetch('/api/dashboard/trends', { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('trends HTTP ' + r.status); return r.json(); }),
    ])
      .then(function (results) {
        if (myGen !== requestGen) return; // Stale — skip render.
        setRetryDisabled(false);

        var data = results[0].status === 'fulfilled' ? results[0].value : null;
        var trendsFulfilled = results[1].status === 'fulfilled';
        var trends = trendsFulfilled ? results[1].value : { assets: [], users: [], assignments: [], vendors: [] };

        if (!data) {
          console.error('Dashboard stats unavailable:', results[0].reason);
          if (results[1].status === 'rejected') console.warn('Dashboard trends also unavailable (sparklines disabled):', results[1].reason);

          // Per-card "Failed" replaces the "--" placeholder.
          STAT_IDS.forEach(function (id) { setStatState(id, 'error', 'Stats request failed'); });

          // Always clear sparklines when stats failed — leaving a prior
          // successful render on screen would mislead the user into
          // thinking the dashboard is half-working.
          SPARK_IDS.forEach(showSparklineError);

          var reason = (results[0].reason && results[0].reason.message) ? results[0].reason.message : '';
          setBanner('error', 'Stats API request failed' + (reason ? ': ' + reason : '') + '. Click Retry to try again.');

          renderActivity(null, true);
          return;
        }

        if (!trendsFulfilled) console.warn('Dashboard trends unavailable (sparklines disabled):', results[1].reason);

        // Success — per-stat numbers via the shared state helper.
        var assetsByStatus = data.assetsByStatus || [];
        var assigned = assetsByStatus.find(function (s) { return s.status === 'ASSIGNED'; });
        setStatState('stat-total-assets', 'ok', data.totalAssets);
        setStatState('stat-assigned',      'ok', assigned ? assigned.count : 0);
        setStatState('stat-users',         'ok', data.totalUsers);
        setStatState('stat-vendors',       'ok', data.totalVendors);
        setStatState('stat-locations',     'ok', data.totalLocations);

        // Quick stats
        var inRepair = assetsByStatus.find(function (s) { return s.status === 'IN_REPAIR'; });
        var retired  = assetsByStatus.find(function (s) { return s.status === 'RETIRED'; });
        var inStock  = assetsByStatus.find(function (s) { return s.status === 'IN_STOCK'; });
        var total    = data.totalAssets || 1;

        setText('qs-in-repair', inRepair ? inRepair.count : 0);
        setText('qs-retired',   retired  ? retired.count  : 0);
        setText('qs-instock',   inStock  ? inStock.count  : 0);
        setWidth('qs-bar-inrepair', ((inRepair ? inRepair.count : 0) / total * 100).toFixed(0) + '%');
        setWidth('qs-bar-retired',  ((retired  ? retired.count  : 0) / total * 100).toFixed(0) + '%');
        setWidth('qs-bar-instock',  ((inStock  ? inStock.count  : 0) / total * 100).toFixed(0) + '%');

        // Sparklines (7-day trends per stat card). On trends failure each
        // sparkline shows an explicit "Failed" indicator rather than a
        // misleading flat-zero line.
        if (trendsFulfilled) {
          ['assets', 'assignments', 'users', 'vendors'].forEach(function (id) {
            var elId = 'sparkline-' + id;
            var arr = (trends && trends[id]) || [];
            renderSparkline(elId, arr, SPARK_COLOR[elId] || '#5156be');
            var sum = arr.reduce(function (a, b) { return a + b; }, 0);
            setText(elId + '-total', sum + (id === 'vendors' ? ' new in 7d' : ' in 7d'));
          });
        } else {
          SPARK_IDS.forEach(showSparklineError);
        }

        // Chart: Assets by Category (horizontal bar)
        var catEl = document.getElementById('chart-assets-by-category');
        if (catEl) {
          var catColors = getChartColorsArray(catEl);
          var catData = (data.assetsByCategory || []).slice(0, 8);
          var catChart = new ApexCharts(catEl, {
            series: [{ name: 'Assets', data: catData.map(function (c) { return c.count; }) }],
            chart: { type: 'bar', height: 320, toolbar: { show: false } },
            colors: catColors,
            plotOptions: { bar: { horizontal: true, borderRadius: 4, dataLabels: { position: 'top' } } },
            dataLabels: { enabled: true, formatter: function (v) { return v; }, style: { fontSize: '12px' } },
            xaxis: { categories: catData.map(function (c) { return c.category; }), labels: { formatter: function (v) { return Math.round(v); } } },
            tooltip: { y: { formatter: function (v) { return v + ' asset(s)'; } } },
            grid: { borderColor: '#f1f1f1' }
          });
          catChart.render();
        }

        // Chart: Assets by Status (donut)
        var statusEl = document.getElementById('chart-assets-by-status');
        if (statusEl) {
          var statusColors = getChartColorsArray(statusEl);
          var statusData = assetsByStatus.map(function (s) { return STATUS_LABELS[s.status] || s.status; });
          var statusCounts = assetsByStatus.map(function (s) { return s.count; });
          var statusChart = new ApexCharts(statusEl, {
            series: statusCounts.length ? statusCounts : [0],
            chart: { type: 'donut', height: 320 },
            labels: statusData.length ? statusData : ['No assets'],
            colors: statusColors,
            legend: { position: 'bottom' },
            dataLabels: { enabled: true, formatter: function (v, opts) { return opts.w.config.series[opts.seriesIndex]; } },
            tooltip: { y: { formatter: function (v) { return v + ' asset(s)'; } } }
          });
          statusChart.render();
        }

        // Recent activity
        renderActivity(data.recentActivity);
      })
      .catch(function (err) {
        if (myGen !== requestGen) return; // Stale — skip error UI too.
        setRetryDisabled(false);
        console.error('Dashboard init crashed:', err);
        STAT_IDS.forEach(function (id) { setStatState(id, 'error', String(err && err.message || err)); });
        SPARK_IDS.forEach(showSparklineError);
        setBanner('error', 'Dashboard init failed: ' + (err && err.message ? err.message : err));
        renderActivity(null, true);
      });
  }

  function init() {
    loadDashboard();
    var retry = document.getElementById('dashboard-retry-btn');
    if (retry) retry.addEventListener('click', loadDashboard);
  }

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
