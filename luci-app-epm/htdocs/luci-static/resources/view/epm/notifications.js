'use strict';
'require view';
'require view.epm.common as common';

return view.extend({
	load: function() {
		/* Sequential on purpose: both endpoints shell out to lpac, and this
		   modem's MBIM channel/proxy doesn't reliably handle two concurrent
		   lpac invocations (occasionally fails with "no channel response
		   received"). Firing them via Promise.all raced the two calls and
		   made this page load "with variable success". */
		return common.getJSON('notifications').then(function(notifications) {
			return common.getJSON('profiles').then(function(profiles) {
				return [ notifications, profiles ];
			});
		});
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
		var data = res[0], profilesRes = res[1];
		var self = this;

		var providerByIccid = {};
		if (profilesRes && profilesRes.success) {
			(profilesRes.profiles || []).forEach(function(p) {
				if (p.iccid) providerByIccid[p.iccid] = p.serviceProviderName || _('Unknown provider');
			});
		}

		if (!data || !data.success) {
			return E('p', { 'class': 'cbi-section-descr' }, [ (data && data.error) || _('Failed to load notifications') ]);
		}

		var notifications = data.notifications || [];

		if (!notifications.length) {
			return E('p', { 'class': 'cbi-section-descr' }, [ _('No pending notifications.') ]);
		}

		var opLabels = { install: _('INSTALL'), enable: _('ENABLE'), disable: _('DISABLE'), delete: _('DELETE') };
		var opClass = { install: 'notice', enable: 'success', disable: 'warning', delete: 'danger' };

		var rows = notifications.map(function(n) {
			var op = String(n.profileManagementOperation || 'unknown').toLowerCase();
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left' }, [ String(n.seqNumber != null ? n.seqNumber : '-') ]),
				E('td', { 'class': 'td left', 'style': 'font-family:monospace;font-size:12px' }, [ n.iccid || '-' ]),
				E('td', { 'class': 'td left' }, [ providerByIccid[n.iccid] || _('Unknown') ]),
				E('td', { 'class': 'td left' }, [
					E('span', { 'class': 'label ' + (opClass[op] || 'notice') }, [ opLabels[op] || op.toUpperCase() ])
				]),
				E('td', { 'class': 'td right' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						'click': function() { self.act('notification_process', n.seqNumber); }
					}, [ _('Process') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button-remove',
						'click': function() { self.act('notification_remove', n.seqNumber); }
					}, [ _('Remove') ])
				])
			]);
		});

		return E('div', {}, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Pending Notifications')),
				E('div', { 'class': 'table-responsive' }, [
					E('table', { 'class': 'table' }, [
						E('tr', { 'class': 'tr table-titles' }, [
							E('th', { 'class': 'th' }, [ _('Sequence') ]),
							E('th', { 'class': 'th' }, [ _('ICCID') ]),
							E('th', { 'class': 'th' }, [ _('Provider') ]),
							E('th', { 'class': 'th' }, [ _('Operation') ]),
							E('th', { 'class': 'th right' }, [ _('Actions') ])
						])
					].concat(rows))
				]),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						'click': function() { self.act('notification_process_all', null); }
					}, [ _('Process All') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button-remove',
						'click': function() { self.act('notification_remove_all', null); }
					}, [ _('Remove All') ]),
					' ',
					E('button', { 'class': 'btn cbi-button', 'click': function() { self.reload(); } }, [ _('Refresh') ])
				])
			])
		]);
	},

	render: function(res) {
		this.bodyNode = this.renderBody(res);
		return this.bodyNode;
	},

	act: function(endpoint, seqNumber) {
		var self = this;
		var params = seqNumber != null ? { seqNumber: seqNumber } : {};
		common.postForm(endpoint, params).then(function(data) {
			if (data.type === 'lpa' && data.payload && data.payload.code === 0) {
				common.notifySuccess(_('Success'), data.payload.message || _('Done'));
				self.reload();
			} else if (data.success) {
				common.notifySuccess(_('Success'), data.message || _('Done'));
				self.reload();
			} else {
				common.notifyError(_('Error'), common.lpaErrorMessage(data) || data.error);
			}
		}).catch(function() { common.notifyError(_('Error'), _('Request failed')); });
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
