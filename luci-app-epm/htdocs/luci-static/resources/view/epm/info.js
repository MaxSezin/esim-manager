'use strict';
'require view';
'require view.epm.common as common';

/*
	eSIM Profile Manager - eSIM Info page.

	This app is split into one real LuCI page per section (info/profiles/
	download/notifications/config), registered as sibling menu entries
	under admin/modem/epm, rather than a single page with client-side
	tab-switching. Sibling pages under the same menu node get their tab
	bar rendered entirely by the theme (see the active theme's
	menu-*.js, renderTabMenu()) - the exact mechanism the vendor's own
	"5G Modem" pages use - so active/inactive tab styling, colors and
	spacing all come from the theme automatically instead of being
	hand-rolled and re-broken every time a CSS assumption turns out wrong.

	Ships with NO app-specific CSS file: every element below uses LuCI's
	own CBI classes (cbi-section, table/tr/td, etc.), which the active
	theme already styles for every other admin page.

	The backend is untouched: this still talks to the existing epm.lua
	controller's JSON endpoints via view.epm.common.
*/

return view.extend({
	load: function() {
		return common.getJSON('status');
	},

	render: function(data) {
		if (!data || !data.success) {
			return E('p', { 'class': 'cbi-section-descr' }, [
				(data && data.error) || _('Failed to load eSIM information')
			]);
		}

		var info = data.info || {};
		var mem = info.extCardResource || {};

		function row(label, value) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'style': 'width:33%' }, [ E('strong', {}, label + ':') ]),
				E('td', { 'class': 'td left' }, [ String(value) ])
			]);
		}

		return E('div', {}, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Basic Information')),
				E('table', { 'class': 'table' }, [
					row(_('EID'), data.eid || '-'),
					row(_('Profile Version'), info.profileVersion || '-'),
					row(_('SVN'), info.svn || '-'),
					row(_('Firmware Version'), info.euiccFirmwareVer || '-')
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Memory Information')),
				E('table', { 'class': 'table' }, [
					row(_('Free Non-Volatile Memory'), (mem.freeNonVolatileMemory || 0) + ' ' + _('bytes')),
					row(_('Free Volatile Memory'), (mem.freeVolatileMemory || 0) + ' ' + _('bytes')),
					row(_('Installed Applications'), mem.installedApplication || 0)
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
