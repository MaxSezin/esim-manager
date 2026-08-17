'use strict';
'require view';
'require view.epm.common as common';

return view.extend({
	load: function() {
		return Promise.all([ common.getJSON('profiles'), common.getJSON('reboot_status') ]);
	},

	displayName: function(p) {
		if (p.profileNickname && p.profileNickname.trim() !== '') return p.profileNickname;
		if (p.profileName && p.profileName.trim() !== '') return p.profileName;
		if (p.serviceProviderName && p.serviceProviderName.trim() !== '') return p.serviceProviderName;
		return _('Unknown');
	},

	reload: function() {
		var self = this;
		return this.load().then(function(res) {
			var newBody = self.renderBody(res);
			self.bodyNode.parentNode.replaceChild(newBody, self.bodyNode);
			self.bodyNode = newBody;
		});
	},

	renderBody: function(res) {
		var data = res[0], reboot = res[1];
		var self = this;
		var nodes = [];

		if (reboot && reboot.success && reboot.reboot_needed) {
			nodes.push(E('div', { 'class': 'alert-message warning' }, [
				E('strong', {}, _('Modem Restart Required') + ': '),
				reboot.reason || _('Profile changes require a modem restart to take effect.'),
				' ',
				E('button', {
					'class': 'btn cbi-button-action',
					'click': common.restartModem
				}, [ _('Restart Now') ])
			]));
		}

		if (!data || !data.success) {
			nodes.push(E('p', { 'class': 'cbi-section-descr' }, [ (data && data.error) || _('Failed to load profiles') ]));
			return E('div', {}, nodes);
		}

		var profiles = data.profiles || [];

		if (!profiles.length) {
			nodes.push(E('p', { 'class': 'cbi-section-descr' }, [ _('No eSIM profiles installed.') ]));
			return E('div', {}, nodes);
		}

		var rows = profiles.map(function(p) {
			var name = self.displayName(p);
			var enabled = p.profileState === 'enabled';
			var statusClass = (p.profileState === 'enabled' || p.profileState === 'disabled') ? p.profileState : 'unknown';
			var statusLabel = { enabled: _('ENABLED'), disabled: _('DISABLED') }[statusClass] || _('UNKNOWN');

			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left' }, [ name ]),
				E('td', { 'class': 'td left', 'style': 'font-family:monospace' }, [ p.iccid || '-' ]),
				E('td', { 'class': 'td left' }, [ p.serviceProviderName || '-' ]),
				E('td', { 'class': 'td center' }, [
					E('span', { 'class': 'label ' + (statusClass === 'enabled' ? 'success' : (statusClass === 'disabled' ? 'danger' : 'notice')) }, [ statusLabel ])
				]),
				E('td', { 'class': 'td right' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						'click': function() { self.toggle(p.iccid, enabled ? 'disable' : 'enable', name); }
					}, [ enabled ? _('Disable') : _('Enable') ]),
					' ',
					E('button', {
						'class': 'btn',
						'click': function() { self.rename(p.iccid, name); }
					}, [ _('Rename') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button-remove',
						'click': function() { self.remove(p.iccid, name); }
					}, [ _('Delete') ])
				])
			]);
		});

		nodes.push(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Installed Profiles')),
			E('div', { 'class': 'table-responsive' }, [
				E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr table-titles' }, [
						E('th', { 'class': 'th' }, [ _('Profile Name') ]),
						E('th', { 'class': 'th' }, [ _('ICCID') ]),
						E('th', { 'class': 'th' }, [ _('Provider') ]),
						E('th', { 'class': 'th center' }, [ _('Status') ]),
						E('th', { 'class': 'th right' }, [ _('Actions') ])
					])
				].concat(rows))
			]),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'btn cbi-button', 'click': function() { self.reload(); } }, [ _('Refresh') ])
			])
		]));

		return E('div', {}, nodes);
	},

	render: function(res) {
		common.ensurePageHeader();
		this.bodyNode = this.renderBody(res);
		return this.bodyNode;
	},

	toggle: function(iccid, action, name) {
		var self = this;
		var go = function() {
			return common.postForm('toggle', { iccid: iccid, action: action }).then(function(data) {
				if (!data.success) { common.notifyError(_('Error'), data.error || _('Unknown error')); return; }
				self.reload();
				if (action === 'enable') {
					return common.confirmModal(_('Restart Modem?'),
						_('Profile "%s" has been enabled. It will not be active until the modem is restarted. Restart now?').format(name)
					).then(function(yes) { if (yes) common.restartModem(); });
				}
			}).catch(function() { common.notifyError(_('Error'), _('Failed to toggle profile')); });
		};

		if (action === 'enable') {
			common.confirmModal(_('Enable profile?'),
				_('Enable profile "%s"? A modem restart will be required afterwards for it to take effect.').format(name)
			).then(function(yes) { if (yes) go(); });
		} else {
			go();
		}
	},

	rename: function(iccid, currentName) {
		var self = this;
		common.promptModal(_('Rename profile'), _('New nickname:'), currentName).then(function(newName) {
			if (newName == null || newName.trim() === '') return;
			common.postForm('nickname', { iccid: iccid, nickname: newName.trim() }).then(function(data) {
				if (!data.success) { common.notifyError(_('Error'), data.error || _('Unknown error')); return; }
				self.reload();
			}).catch(function() { common.notifyError(_('Error'), _('Failed to change profile name')); });
		});
	},

	remove: function(iccid, name) {
		var self = this;
		common.confirmModal(_('Delete profile'), _('Delete profile "%s"? This cannot be undone.').format(name)).then(function(yes) {
			if (!yes) return;
			common.postForm('delete', { iccid: iccid }).then(function(data) {
				if (!data.success) { common.notifyError(_('Error'), data.error || _('Unknown error')); return; }
				self.reload();
				common.notifySuccess(_('Profile deleted'),
					_('To fully release the deleted eSIM, process its delete notification on the Notifications tab as soon as possible.'));
			}).catch(function() { common.notifyError(_('Error'), _('Failed to delete profile')); });
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
