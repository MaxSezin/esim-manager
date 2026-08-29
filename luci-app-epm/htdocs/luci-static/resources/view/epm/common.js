'use strict';
'require baseclass';
'require request';
'require ui';

/*
	eSIM Profile Manager - shared helpers for the epm/*.js pages.

	Loaded via 'require view.epm.common as common' (LuCI's per-view shared
	module convention - same pattern the vendor's own 5gmodem pages use for
	view.modem5g.mutil). Not a page itself: just request/dialog helpers
	common to all five eSIM Manager pages.
*/

function epmUrl(part) {
	return L.url('admin', 'modem', 'epm', part);
}

/* URL of one of our own admin pages (tab-info/tab-profiles/...), as
   opposed to epmUrl() which builds a JSON API endpoint URL. Kept as a
   separate helper since the two happen to share a base path but are
   conceptually different - the "tab-" prefix on page paths exists
   specifically so page URLs never collide with API endpoint names like
   "profiles" or "config". */
function pageUrl(name) {
	return L.url('admin', 'modem', 'epm', 'tab-' + name);
}

function getJSON(part) {
	return request.get(epmUrl(part)).then(function(res) { return res.json(); });
}

function postForm(part, params) {
	var body = Object.keys(params || {}).map(function(k) {
		return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
	}).join('&');

	return request.post(epmUrl(part), body, {
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
	}).then(function(res) { return res.json(); });
}

function lpaErrorMessage(data) {
	var msg = '';
	if (data && data.payload) {
		if (data.payload.message) msg = data.payload.message;
		if (data.payload.data) msg += (msg ? ' - ' : '') + data.payload.data;
		if (data.payload.code !== undefined) msg += ' (code: ' + data.payload.code + ')';
	}
	return msg || _('Unknown error occurred');
}

function notifyError(title, message) {
	ui.addNotification(title, E('p', {}, [ message ]), 'error');
}

function notifySuccess(title, message) {
	ui.addTimeLimitedNotification(title, E('p', {}, [ message ]), 4000, 'info');
}

function confirmModal(title, message) {
	return new Promise(function(resolve) {
		ui.showModal(title, [
			E('p', {}, [ message ]),
			E('div', { 'class': 'right' }, [
				E('button', { 'type': 'button', 'class': 'btn', 'click': function() { ui.hideModal(); resolve(false); } }, [ _('Cancel') ]),
				' ',
				E('button', { 'type': 'button',
					'class': 'btn cbi-button-action',
					'click': function() { ui.hideModal(); resolve(true); }
				}, [ _('OK') ])
			])
		]);
	});
}

function promptModal(title, label, value) {
	return new Promise(function(resolve) {
		var input = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': value || '' });
		ui.showModal(title, [
			E('p', {}, [ label ]),
			input,
			E('div', { 'class': 'right', 'style': 'margin-top: 10px' }, [
				E('button', { 'type': 'button', 'class': 'btn', 'click': function() { ui.hideModal(); resolve(null); } }, [ _('Cancel') ]),
				' ',
				E('button', { 'type': 'button',
					'class': 'btn cbi-button-action',
					'click': function() { var v = input.value; ui.hideModal(); resolve(v); }
				}, [ _('Save') ])
			])
		]);
		input.focus();
	});
}

function loadingSpinner(text) {
	return E('p', { 'class': 'cbi-section-descr spinning' }, [ text || _('Loading…') ]);
}

/* This theme doesn't auto-render a page title/description above the tab
   bar the way some LuCI themes do for a Map()'s title/descr - without
   this, the five pages open straight into the tab bar with nothing above
   it saying which app you're even in. Unlike a normal render() return
   value, the tab bar itself (.cbi-tabmenu) lives OUTSIDE the region our
   view's render() populates - it's inserted by the theme itself - so the
   header can't just be prepended to our own content, it has to be
   inserted as a sibling before that same tab bar. This is the exact
   technique the vendor's own modemtabs.js uses for its "Thales MV31-W"
   bar above the Сеть/eSIM/Модем/... tabs (see its renderBar()).
   Idempotent: each of the 5 pages calls this once from render(), and a
   page reload/refresh must not insert a second copy. */
function ensurePageHeader() {
	if (document.getElementById('epm-page-header')) return;

	var el = E('div', { 'id': 'epm-page-header' }, [
		E('h2', {}, _('eSIM Profile Manager')),
		E('div', { 'class': 'cbi-map-descr' }, [ _('Manage eSIM profiles using lpac') ])
	]);

	var anchor = document.querySelector('#tabmenu')
		|| document.querySelector('ul.cbi-tabmenu')
		|| document.querySelector('.cbi-tabmenu');

	if (anchor && anchor.parentNode) {
		anchor.parentNode.insertBefore(el, anchor);
		return;
	}

	var c = document.querySelector('#maincontent') || document.querySelector('#view') || document.body;
	if (c) c.insertBefore(el, c.firstChild);
}

function waitForModem() {
	getJSON('status').then(function() {
		ui.hideModal();
		notifySuccess(_('Modem ready'), _('The modem has restarted successfully.'));
		window.location.reload();
	}).catch(function() {
		window.setTimeout(waitForModem, 5000);
	});
}

/* Shared modem restart flow, used from the Profiles page (post enable/
   disable banner) and the Config page (standalone button). Each eSIM
   Manager page is its own real LuCI view now, so "recover" here just
   means reloading whichever page called this once the modem answers
   again. */
function restartModem() {
	confirmModal(_('Restart modem'),
		_('The modem will restart now. This takes a couple of minutes and you will lose connectivity temporarily. Continue?')
	).then(function(yes) {
		if (!yes) return;

		ui.showModal(_('Restarting Modem'), [
			E('p', {}, [ _('The modem is being restarted. This page will refresh automatically once it is back.') ]),
			E('p', { 'class': 'spinning' }, [ _('Please wait…') ])
		]);

		postForm('reboot_modem', {}).then(function(data) {
			if (!data.success) {
				ui.hideModal();
				notifyError(_('Error'), data.error || _('Failed to restart the modem'));
				return;
			}
			window.setTimeout(waitForModem, 15000);
		}).catch(function() {
			ui.hideModal();
			notifyError(_('Error'), _('Failed to restart the modem'));
		});
	});
}

return baseclass.extend({
	epmUrl: epmUrl,
	pageUrl: pageUrl,
	ensurePageHeader: ensurePageHeader,
	getJSON: getJSON,
	postForm: postForm,
	lpaErrorMessage: lpaErrorMessage,
	notifyError: notifyError,
	notifySuccess: notifySuccess,
	confirmModal: confirmModal,
	promptModal: promptModal,
	loadingSpinner: loadingSpinner,
	restartModem: restartModem
});
