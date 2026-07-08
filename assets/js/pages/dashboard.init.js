// dashboard.init.js — fetches /api/dashboard/stats and renders ApexCharts
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

  // Render the recent activity feed
  function renderActivity(activity) {
    var list = document.getElementById('recent-activity-list');
    if (!list) return;
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Status display labels
  var STATUS_LABELS = {
    IN_STOCK: 'In Stock',
    ASSIGNED: 'Assigned',
    IN_REPAIR: 'In Repair',
    RETIRED: 'Retired',
    LOST: 'Lost'
  };

  // Fetch stats and render everything
  function init() {
    fetch('/api/dashboard/stats', { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        // Safe element setter helper
        function setText(id, val) {
          var el = document.getElementById(id);
          if (el) el.textContent = val;
        }
        function setWidth(id, val) {
          var el = document.getElementById(id);
          if (el) el.style.width = val;
        }

        // Stat cards
        setText('stat-total-assets', data.totalAssets);
        var assigned = (data.assetsByStatus || []).find(function (s) { return s.status === 'ASSIGNED'; });
        setText('stat-assigned', assigned ? assigned.count : 0);
        setText('stat-users', data.totalUsers);
        setText('stat-vendors', data.totalVendors);
        setText('stat-locations', data.totalLocations);

        // Quick stats
        var inRepair = (data.assetsByStatus || []).find(function (s) { return s.status === 'IN_REPAIR'; });
        var retired = (data.assetsByStatus || []).find(function (s) { return s.status === 'RETIRED'; });
        var inStock = (data.assetsByStatus || []).find(function (s) { return s.status === 'IN_STOCK'; });
        var total = data.totalAssets || 1;

        var irCount = inRepair ? inRepair.count : 0;
        var rtCount = retired ? retired.count : 0;
        var isCount = inStock ? inStock.count : 0;

        setText('qs-in-repair', irCount);
        setText('qs-retired', rtCount);
        setText('qs-instock', isCount);
        setWidth('qs-bar-inrepair', (irCount / total * 100).toFixed(0) + '%');
        setWidth('qs-bar-retired', (rtCount / total * 100).toFixed(0) + '%');
        setWidth('qs-bar-instock', (isCount / total * 100).toFixed(0) + '%');

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
          var statusData = (data.assetsByStatus || []).map(function (s) {
            return STATUS_LABELS[s.status] || s.status;
          });
          var statusCounts = (data.assetsByStatus || []).map(function (s) { return s.count; });
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
        console.error('Dashboard init failed:', err);
        var list = document.getElementById('recent-activity-list');
        if (list) list.innerHTML = '<li class="activity-list text-center text-muted py-4">Failed to load dashboard data.</li>';
      });
  }

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
