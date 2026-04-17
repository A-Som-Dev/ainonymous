(function () {
  var statEls = {
    secrets:  document.getElementById('statSecrets'),
    identity: document.getElementById('statIdentity'),
    code:     document.getElementById('statCode'),
    total:    document.getElementById('statTotal'),
  };
  var statusDot  = document.getElementById('statusDot');
  var statusText = document.getElementById('statusText');
  var eventBody  = document.getElementById('eventBody');
  var entryCount = document.getElementById('entryCount');
  var rowCount   = 0;
  var MAX_ROWS   = 200;

  function formatTime(ts) {
    var d = new Date(ts);
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    var s = String(d.getSeconds()).padStart(2, '0');
    return h + ':' + m + ':' + s;
  }

  function updateStats(data) {
    statEls.secrets.textContent  = data.secrets;
    statEls.identity.textContent = data.identity;
    statEls.code.textContent     = data.code;
    statEls.total.textContent    = data.total;
  }

  function addEntry(entry) {
    var empty = eventBody.querySelector('.empty-state-row');
    if (empty) empty.remove();

    var tr = document.createElement('tr');
    tr.className = 'new-row';

    var tdTime = document.createElement('td');
    tdTime.className = 'mono';
    tdTime.textContent = formatTime(entry.timestamp);

    var tdLayer = document.createElement('td');
    var badge = document.createElement('span');
    badge.className = 'badge badge-' + entry.layer;
    badge.textContent = entry.layer;
    tdLayer.appendChild(badge);

    var tdType = document.createElement('td');
    tdType.textContent = entry.type;

    var tdPseudo = document.createElement('td');
    tdPseudo.className = 'mono';
    var code = document.createElement('code');
    code.textContent = entry.pseudonym;
    tdPseudo.appendChild(code);

    tr.append(tdTime, tdLayer, tdType, tdPseudo);

    eventBody.insertBefore(tr, eventBody.firstChild);
    rowCount++;

    while (eventBody.children.length > MAX_ROWS) {
      eventBody.removeChild(eventBody.lastChild);
    }

    entryCount.textContent = rowCount + ' entries';

    setTimeout(function () { tr.classList.remove('new-row'); }, 350);
  }

  function connect() {
    // If the dashboard was opened with ?token=X, propagate it to the SSE
    // subscription so auth works without a custom Authorization header
    // (EventSource doesn't allow headers). The server accepts ?token= as
    // an auth source since v1.2.0 B6.
    var params = new URLSearchParams(window.location.search);
    var token = params.get('token');
    var eventsUrl = token ? '/events?token=' + encodeURIComponent(token) : '/events';
    var source = new EventSource(eventsUrl);

    source.addEventListener('stats', function (e) {
      updateStats(JSON.parse(e.data));
    });

    source.addEventListener('entry', function (e) {
      addEntry(JSON.parse(e.data));
    });

    source.addEventListener('open', function () {
      statusDot.classList.remove('disconnected');
      statusText.textContent = 'Live';
    });

    source.addEventListener('error', function () {
      statusDot.classList.add('disconnected');
      statusText.textContent = 'Reconnecting...';
    });
  }

  connect();
})();
