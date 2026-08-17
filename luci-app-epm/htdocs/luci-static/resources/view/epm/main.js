'use strict';
'require view';
'require request';
'require ui';

/*
	eSIM Profile Manager - native LuCI JS-view.

	This intentionally ships with NO app-specific CSS file: every element
	below uses LuCI's own CBI classes (cbi-section, cbi-value, table/tr/td,
	cbi-tabmenu, etc.), which the active theme already styles for every
	other admin page. That's what makes this render correctly under any
	theme (light, dark, or a custom skin like this router's own) without
	us having to hand-maintain colors.

	The backend is untouched: this still talks to the existing epm.lua
	controller's JSON endpoints (L.url('admin','modem','epm', ...)), the
	same ones the previous hand-rolled htm+jQuery-less XHR frontend used.
	Only the rendering layer changed.
*/

function fmtBytes(n) {
	return (n || 0) + ' ' + _('bytes');
}

function infoRow(label, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'style': 'width:33%' }, [ E('strong', {}, label + ':') ]),
		E('td', { 'class': 'td left' }, [ value ])
	]);
}

return view.extend({
	load: function() {
		return request.get(L.url('admin', 'modem', 'epm', 'status')).then(function(res) {
			return res.json();
		}).catch(function() {
			return { success: false, error: _('Request failed') };
		});
	},

	renderBody: function(data) {
		if (data && data.success) {
			var info = data.info || {};
			var mem = info.extCardResource || {};

			return E('div', {}, [
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('Basic Information')),
					E('table', { 'class': 'table' }, [
						infoRow(_('EID'), data.eid || '-'),
						infoRow(_('Profile Version'), info.profileVersion || '-'),
						infoRow(_('SVN'), info.svn || '-'),
						infoRow(_('Firmware Version'), info.euiccFirmwareVer || '-')
					])
				]),
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('Memory Information')),
					E('table', { 'class': 'table' }, [
						infoRow(_('Free Non-Volatile Memory'), fmtBytes(mem.freeNonVolatileMemory)),
						infoRow(_('Free Volatile Memory'), fmtBytes(mem.freeVolatileMemory)),
						infoRow(_('Installed Applications'), mem.installedApplication || 0)
					])
				]),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'click': ui.createHandlerFn(this, 'handleRefresh')
					}, [ _('Refresh') ])
				])
			]);
		}

		return E('p', { 'class': 'cbi-section-descr' }, [
			(data && data.error) || _('Failed to load eSIM information')
		]);
	},

	render: function(data) {
		this.bodyNode = this.renderBody(data);

		return E('div', {}, [
			E('h2', {}, _('eSIM Profile Manager')),
			E('div', { 'class': 'cbi-map-descr' }, _('Manage eSIM profiles using lpac')),
			this.bodyNode
		]);
	},

	handleRefresh: function(ev) {
		ev.preventDefault();
		return this.load().then(L.bind(function(data) {
			var newBody = this.renderBody(data);
			this.bodyNode.parentNode.replaceChild(newBody, this.bodyNode);
			this.bodyNode = newBody;
		}, this));
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
