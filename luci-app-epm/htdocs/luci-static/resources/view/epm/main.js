'use strict';
'require view';
'require request';
'require ui';

/*
	eSIM Profile Manager - native LuCI JS-view.

	Ships with NO app-specific CSS file: every element below uses LuCI's own
	CBI classes (cbi-section, cbi-value, cbi-tabmenu, table/tr/td, etc.),
	which the active theme already styles for every other admin page. That
	is what makes this render correctly under any theme (light, dark, or a
	custom skin) without hand-maintained colors, unlike the old bespoke
	.htm + custom-CSS frontend this replaces.

	The backend is untouched: this still talks to the existing epm.lua
	controller's JSON endpoints (L.url('admin','modem','epm', ...)), the
	same ones the previous XHR-based frontend used. Only the rendering
	layer is different. Confirm/prompt dialogs use ui.showModal instead of
	the browser's native confirm()/prompt(), and toasts use
	ui.addNotification instead of a hand-rolled banner.
*/

function epmUrl(part) {
	return L.url('admin', 'modem', 'epm', part);
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
				E('button', { 'class': 'btn', 'click': function() { ui.hideModal(); resolve(false); } }, [ _('Cancel') ]),
				' ',
				E('button', {
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
				E('button', { 'class': 'btn', 'click': function() { ui.hideModal(); resolve(null); } }, [ _('Cancel') ]),
				' ',
				E('button', {
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

/* Shared modem restart flow, callable from any tab. Not just for the
   post-enable/disable "restart needed" banner: this modem's eUICC/MBIM
   channel can get stuck on its own (e.g. after a while, or following a
   slot switch), and the reboot-needed flag doesn't always get set for
   that. A standalone restart button (Config tab) covers that case too. */
function restartModem(ctx) {
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
			window.setTimeout(function() { ctx.waitForModem(); }, 15000);
		}).catch(function() {
			ui.hideModal();
			notifyError(_('Error'), _('Failed to restart the modem'));
		});
	});
}

/* ==================== TAB: eSIM Info ==================== */

var InfoTab = {
	title: _('eSIM Info'),

	load: function() {
		return getJSON('status');
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
	}
};

/* ==================== TAB: Profiles ==================== */

var ProfilesTab = {
	title: _('Profiles'),

	load: function() {
		return Promise.all([ getJSON('profiles'), getJSON('reboot_status') ]);
	},

	displayName: function(p) {
		if (p.profileNickname && p.profileNickname.trim() !== '') return p.profileNickname;
		if (p.profileName && p.profileName.trim() !== '') return p.profileName;
		if (p.serviceProviderName && p.serviceProviderName.trim() !== '') return p.serviceProviderName;
		return _('Unknown');
	},

	render: function(res, ctx) {
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
					'click': function() { self.reboot(ctx); }
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
						'click': function() { self.toggle(ctx, p.iccid, enabled ? 'disable' : 'enable', name); }
					}, [ enabled ? _('Disable') : _('Enable') ]),
					' ',
					E('button', {
						'class': 'btn',
						'click': function() { self.rename(ctx, p.iccid, name); }
					}, [ _('Rename') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button-remove',
						'click': function() { self.remove(ctx, p.iccid, name); }
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
				E('button', { 'class': 'btn cbi-button', 'click': function() { ctx.reloadTab(); } }, [ _('Refresh') ])
			])
		]));

		return E('div', {}, nodes);
	},

	toggle: function(ctx, iccid, action, name) {
		var self = this;
		var go = function() {
			return postForm('toggle', { iccid: iccid, action: action }).then(function(data) {
				if (!data.success) { notifyError(_('Error'), data.error || _('Unknown error')); return; }
				ctx.reloadTab();
				if (action === 'enable') {
					return confirmModal(_('Restart Modem?'),
						_('Profile "%s" has been enabled. It will not be active until the modem is restarted. Restart now?').format(name)
					).then(function(yes) { if (yes) self.reboot(ctx); });
				}
			}).catch(function() { notifyError(_('Error'), _('Failed to toggle profile')); });
		};

		if (action === 'enable') {
			confirmModal(_('Enable profile?'),
				_('Enable profile "%s"? A modem restart will be required afterwards for it to take effect.').format(name)
			).then(function(yes) { if (yes) go(); });
		} else {
			go();
		}
	},

	rename: function(ctx, iccid, currentName) {
		promptModal(_('Rename profile'), _('New nickname:'), currentName).then(function(newName) {
			if (newName == null || newName.trim() === '') return;
			postForm('nickname', { iccid: iccid, nickname: newName.trim() }).then(function(data) {
				if (!data.success) { notifyError(_('Error'), data.error || _('Unknown error')); return; }
				ctx.reloadTab();
			}).catch(function() { notifyError(_('Error'), _('Failed to change profile name')); });
		});
	},

	remove: function(ctx, iccid, name) {
		confirmModal(_('Delete profile'), _('Delete profile "%s"? This cannot be undone.').format(name)).then(function(yes) {
			if (!yes) return;
			postForm('delete', { iccid: iccid }).then(function(data) {
				if (!data.success) { notifyError(_('Error'), data.error || _('Unknown error')); return; }
				ctx.reloadTab();
				notifySuccess(_('Profile deleted'),
					_('To fully release the deleted eSIM, process its delete notification on the Notifications tab as soon as possible.'));
			}).catch(function() { notifyError(_('Error'), _('Failed to delete profile')); });
		});
	},

	reboot: function(ctx) {
		restartModem(ctx);
	}
};

/* ==================== TAB: Download Profile ==================== */

var DownloadTab = {
	title: _('Download Profile'),

	load: function() {
		return Promise.resolve(null);
	},

	render: function(_data, ctx) {
		var qrCode = E('input', { 'type': 'hidden' });
		var qrPreview = E('img', { 'style': 'max-width:300px;max-height:200px;display:none;border:1px solid var(--border-color-medium,#ccc);border-radius:4px' });
		var qrStatus = E('p', { 'class': 'cbi-section-descr' }, []);
		var qrFile = E('input', { 'type': 'file', 'accept': 'image/*', 'class': 'cbi-input-file' });

		var smdp = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': 'rsp.example.com' });
		var actCode = E('input', { 'type': 'text', 'class': 'cbi-input-text' });
		var confCode = E('input', { 'type': 'text', 'class': 'cbi-input-text' });

		var resultBox = E('div', {});

		function decodeQR(file) {
			qrStatus.textContent = _('Decoding QR code…');
			qrCode.value = '';

			var reader = new FileReader();
			reader.onload = function(ev) {
				var img = new Image();
				img.onload = function() {
					var canvas = document.createElement('canvas');
					canvas.width = img.width;
					canvas.height = img.height;
					var ctx2d = canvas.getContext('2d');
					ctx2d.drawImage(img, 0, 0);
					var imageData = ctx2d.getImageData(0, 0, canvas.width, canvas.height);

					ensureJsQR().then(function(jsQR) {
						var code = jsQR(imageData.data, imageData.width, imageData.height);
						if (code && /^LPA:1\$/.test(code.data)) {
							qrCode.value = code.data;
							qrPreview.src = ev.target.result;
							qrPreview.style.display = 'block';
							qrStatus.textContent = _('QR code decoded successfully.');
						} else {
							qrStatus.textContent = _('No valid LPA QR code found in the image.');
						}
					});
				};
				img.src = ev.target.result;
			};
			reader.readAsDataURL(file);
		}

		qrFile.addEventListener('change', function() {
			if (qrFile.files && qrFile.files[0]) decodeQR(qrFile.files[0]);
		});

		function submit() {
			var params = {};
			if (qrCode.value) {
				params.qr_activation_code = qrCode.value;
			} else if (smdp.value.trim() && actCode.value.trim()) {
				params.smdp_server_address = smdp.value.trim();
				params.activation_code = actCode.value.trim();
			} else {
				notifyError(_('Error'), _('Enter a server and activation code, or upload a QR code image'));
				return;
			}
			if (confCode.value.trim()) params.confirmation_code = confCode.value.trim();

			ui.showModal(_('Downloading Profile'), [
				E('p', { 'class': 'spinning' }, [ _('This can take up to a minute…') ])
			]);

			postForm('download', params).then(function(data) {
				ui.hideModal();
				resultBox.appendChild(E('pre', { 'style': 'white-space:pre-wrap;font-size:11px' }, [ JSON.stringify(data, null, 2) ]));

				if (data.type === 'lpa' && data.payload && data.payload.code === 0) {
					notifySuccess(_('Success'), data.payload.message || _('Profile downloaded successfully'));
					qrCode.value = '';
					qrFile.value = '';
					qrPreview.style.display = 'none';
					smdp.value = '';
					actCode.value = '';
					confCode.value = '';
					qrStatus.textContent = '';
					window.setTimeout(function() { ctx.reloadTabId('profiles'); }, 500);
				} else {
					notifyError(_('Download failed'), lpaErrorMessage(data));
				}
			}).catch(function() {
				ui.hideModal();
				notifyError(_('Error'), _('Failed to download profile'));
			});
		}

		return E('div', {}, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('QR Code Upload')),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, [ _('QR Code Image') + ':' ]),
					E('div', { 'class': 'cbi-value-field' }, [
						qrFile,
						E('div', { 'class': 'cbi-value-description' }, [ _('Upload a JPG or PNG image containing the activation QR code') ])
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, []),
					E('div', { 'class': 'cbi-value-field' }, [ qrPreview, qrStatus ])
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Manual Download')),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, [ _('SM-DP+ Server') + ':' ]),
					E('div', { 'class': 'cbi-value-field' }, [ smdp ])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, [ _('Activation Code') + ':' ]),
					E('div', { 'class': 'cbi-value-field' }, [ actCode ])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, [ _('Confirmation Code') + ':' ]),
					E('div', { 'class': 'cbi-value-field' }, [
						confCode,
						E('div', { 'class': 'cbi-value-description' }, [ _('Optional, only if required by the SM-DP+ server') ])
					])
				])
			]),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'btn cbi-button-action', 'click': submit }, [ _('Download Profile') ])
			]),
			resultBox
		]);
	}
};

var jsQRPromise = null;
function ensureJsQR() {
	if (window.jsQR) return Promise.resolve(window.jsQR);
	if (jsQRPromise) return jsQRPromise;

	jsQRPromise = new Promise(function(resolve, reject) {
		var s = document.createElement('script');
		s.src = L.resource('epm/js/jsQR.js');
		s.onload = function() { resolve(window.jsQR); };
		s.onerror = reject;
		document.head.appendChild(s);
	});

	return jsQRPromise;
}

/* ==================== TAB: Notifications ==================== */

var NotificationsTab = {
	title: _('Notifications'),

	load: function() {
		/* Sequential on purpose: both endpoints shell out to lpac, and this
		   modem's MBIM channel/proxy doesn't reliably handle two concurrent
		   lpac invocations (occasionally fails with "no channel response
		   received"). Firing them via Promise.all raced the two calls and
		   made this tab load "with variable success". */
		return getJSON('notifications').then(function(notifications) {
			return getJSON('profiles').then(function(profiles) {
				return [ notifications, profiles ];
			});
		});
	},

	render: function(res, ctx) {
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
						'click': function() { self.act(ctx, 'notification_process', n.seqNumber); }
					}, [ _('Process') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button-remove',
						'click': function() { self.act(ctx, 'notification_remove', n.seqNumber); }
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
						'click': function() { self.act(ctx, 'notification_process_all', null); }
					}, [ _('Process All') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button-remove',
						'click': function() { self.act(ctx, 'notification_remove_all', null); }
					}, [ _('Remove All') ]),
					' ',
					E('button', { 'class': 'btn cbi-button', 'click': function() { ctx.reloadTab(); } }, [ _('Refresh') ])
				])
			])
		]);
	},

	act: function(ctx, endpoint, seqNumber) {
		var params = seqNumber != null ? { seqNumber: seqNumber } : {};
		postForm(endpoint, params).then(function(data) {
			if (data.type === 'lpa' && data.payload && data.payload.code === 0) {
				notifySuccess(_('Success'), data.payload.message || _('Done'));
				ctx.reloadTab();
			} else if (data.success) {
				notifySuccess(_('Success'), data.message || _('Done'));
				ctx.reloadTab();
			} else {
				notifyError(_('Error'), lpaErrorMessage(data) || data.error);
			}
		}).catch(function() { notifyError(_('Error'), _('Request failed')); });
	}
};

/* ==================== TAB: Configuration ==================== */

var ConfigTab = {
	title: _('Configuration'),

	load: function() {
		return getJSON('config');
	},

	render: function(data, ctx) {
		if (!data || !data.success) {
			return E('p', { 'class': 'cbi-section-descr' }, [ (data && data.error) || _('Failed to load configuration') ]);
		}

		var cfg = data.config.epm || {};

		function field(id, value) {
			return E('input', { 'type': 'text', 'class': 'cbi-input-text', 'id': id, 'value': value != null ? value : '' });
		}

		function select(id, options, value) {
			var sel = E('select', { 'class': 'cbi-input-select', 'id': id });
			options.forEach(function(o) {
				sel.appendChild(E('option', { 'value': o[0] }, [ o[1] ]));
			});
			/* Set .value only after every <option> is appended, and do it as a
			   DOM property assignment rather than a "selected" attribute on
			   individual <option> elements built before insertion - the latter
			   is unreliable across browsers/E() attribute handling and left
			   the dropdown always showing its first option regardless of the
			   loaded config. */
			sel.value = value;
			return sel;
		}

		function valueRow(label, node, descr) {
			var field2 = [ node ];
			if (descr) field2.push(E('div', { 'class': 'cbi-value-description' }, [ descr ]));
			return E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ label + ':' ]),
				E('div', { 'class': 'cbi-value-field' }, field2)
			]);
		}

		var apduBackend = select('apdu_backend', [ ['at', 'AT'], ['uqmi', 'QMI'], ['mbim', 'MBIM'] ], cfg.apdu_backend || 'at');
		var jsonOutput = select('json_output', [ ['0', _('Disabled')], ['1', _('Enabled')] ], String(cfg.json_output || '0'));

		var atDevice = field('at_device', cfg.at_device || '/dev/ttyUSB3');
		var qmiDevice = field('qmi_device', cfg.qmi_device || '/dev/cdc-wdm0');
		var qmiSlot = select('qmi_sim_slot', [ ['1', _('Slot 1')], ['2', _('Slot 2')] ], cfg.qmi_sim_slot || '1');
		var mbimDevice = field('mbim_device', cfg.mbim_device || '/dev/cdc-wdm0');
		var mbimProxy = select('mbim_proxy', [ ['0', _('Disabled')], ['1', _('Enabled')] ], String(cfg.mbim_proxy || '0'));
		var mbimSlot = select('mbim_sim_slot', [ ['1', _('Slot 1')], ['2', _('Slot 2')] ], cfg.mbim_sim_slot || '1');

		var tlsPreload = select('tls_gnutls_preload', [ ['0', _('Disabled')], ['1', _('Enabled')] ], String(cfg.tls_gnutls_preload || '0'));
		var tlsPath = field('tls_gnutls_preload_path', cfg.tls_gnutls_preload_path || '/usr/lib/libcurl-gnutls.so.4');

		var rebootMethod = select('reboot_method', [
			['at', _('AT Command')], ['qmi', _('QMI Commands')], ['mbim', _('MBIM Command')],
			['mmcli', _('ModemManager Reset')], ['custom', _('Custom Command')]
		], cfg.reboot_method || 'at');
		var rebootAtCommand = field('reboot_at_command', cfg.reboot_at_command || 'AT+CFUN=1,1');
		var rebootAtDevice = field('reboot_at_device', cfg.reboot_at_device || '/dev/ttyUSB3');
		var rebootQmiDevice = field('reboot_qmi_device', cfg.reboot_qmi_device || '/dev/cdc-wdm0');
		var rebootQmiSlot = select('reboot_qmi_slot', [ ['1', _('Slot 1')], ['2', _('Slot 2')] ], cfg.reboot_qmi_slot || '1');
		var rebootMbimDevice = field('reboot_mbim_device', cfg.reboot_mbim_device || '/dev/cdc-wdm0');
		var rebootCustomCommand = field('reboot_custom_command', cfg.reboot_custom_command || '');

		var deviceRows = {
			atRow: valueRow(_('AT Device'), atDevice),
			qmiRow: valueRow(_('QMI Device'), qmiDevice),
			qmiSlotRow: valueRow(_('QMI SIM Slot'), qmiSlot),
			mbimRow: valueRow(_('MBIM Device'), mbimDevice),
			mbimProxyRow: valueRow(_('Use MBIM Proxy'), mbimProxy),
			mbimSlotRow: valueRow(_('MBIM SIM Slot'), mbimSlot, _('Needed for eUICC/embedded eSIM on some modems, e.g. Foxconn T99W175 / Thales MV31-W'))
		};

		function updateBackendVisibility() {
			var b = apduBackend.value;
			deviceRows.atRow.style.display = (b === 'at') ? '' : 'none';
			deviceRows.qmiRow.style.display = (b === 'uqmi') ? '' : 'none';
			deviceRows.qmiSlotRow.style.display = (b === 'uqmi') ? '' : 'none';
			deviceRows.mbimRow.style.display = (b === 'mbim') ? '' : 'none';
			deviceRows.mbimProxyRow.style.display = (b === 'mbim') ? '' : 'none';
			deviceRows.mbimSlotRow.style.display = (b === 'mbim') ? '' : 'none';
		}
		apduBackend.addEventListener('change', updateBackendVisibility);

		var tlsPathRow = valueRow(_('GnuTLS Library Path'), tlsPath,
			_("Path to the GnuTLS-backed libcurl shared library (e.g. installed via 'apk add libcurl-gnutls4')"));
		function updateTlsVisibility() {
			tlsPathRow.style.display = (tlsPreload.value === '1') ? '' : 'none';
		}
		tlsPreload.addEventListener('change', updateTlsVisibility);

		var rebootRows = {
			at: [ valueRow(_('AT Reset Command'), rebootAtCommand), valueRow(_('AT Device for Reboot'), rebootAtDevice) ],
			qmi: [ valueRow(_('QMI Device for Reboot'), rebootQmiDevice), valueRow(_('QMI SIM Slot for Reboot'), rebootQmiSlot) ],
			mbim: [ valueRow(_('MBIM Device for Reboot'), rebootMbimDevice) ],
			mmcli: [ E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-description', 'style': 'padding-left:0' }, [
					_('Resets the modem’s own radio firmware through ModemManager (mmcli --reset). No device path needed - the modem is looked up automatically. On some modems (e.g. Foxconn T99W175 / Thales MV31-W) this is the only method that reliably recovers the eSIM management channel after it gets stuck following a profile enable/disable - an AT CFUN cycle or even a full router reboot may not be enough.')
				])
			]) ],
			custom: [ valueRow(_('Custom Command'), rebootCustomCommand) ]
		};
		function updateRebootVisibility() {
			var m = rebootMethod.value;
			Object.keys(rebootRows).forEach(function(key) {
				rebootRows[key].forEach(function(row) { row.style.display = (key === m) ? '' : 'none'; });
			});
		}
		rebootMethod.addEventListener('change', updateRebootVisibility);

		function save() {
			var epmConfig = {
				apdu_backend: apduBackend.value,
				at_device: atDevice.value,
				qmi_device: qmiDevice.value,
				qmi_sim_slot: qmiSlot.value,
				mbim_device: mbimDevice.value,
				mbim_proxy: mbimProxy.value,
				mbim_sim_slot: mbimSlot.value,
				tls_gnutls_preload: tlsPreload.value,
				tls_gnutls_preload_path: tlsPath.value,
				reboot_method: rebootMethod.value,
				reboot_at_command: rebootAtCommand.value,
				reboot_at_device: rebootAtDevice.value,
				reboot_qmi_device: rebootQmiDevice.value,
				reboot_qmi_slot: rebootQmiSlot.value,
				reboot_mbim_device: rebootMbimDevice.value,
				reboot_custom_command: rebootCustomCommand.value,
				json_output: jsonOutput.value
			};

			postForm('saveconfig', { config: JSON.stringify({ epm: epmConfig }) }).then(function(res) {
				if (res.success) {
					notifySuccess(_('Saved'), res.message || _('Configuration saved successfully'));
				} else {
					notifyError(_('Error'), res.error || _('Failed to save configuration'));
				}
			}).catch(function() { notifyError(_('Error'), _('Failed to save configuration')); });
		}

		var body = E('div', {}, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Global Settings')),
				valueRow(_('APDU Backend'), apduBackend),
				valueRow(_('Enable Output Logs'), jsonOutput)
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Device Settings')),
				deviceRows.atRow, deviceRows.qmiRow, deviceRows.qmiSlotRow,
				deviceRows.mbimRow, deviceRows.mbimProxyRow, deviceRows.mbimSlotRow
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('TLS Workaround')),
				valueRow(_('GnuTLS Preload'), tlsPreload,
					_('Preload a GnuTLS-backed libcurl before running lpac. Needed when the system libcurl (mbedTLS) cannot validate the SM-DP+ server certificate chain.')),
				tlsPathRow
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Modem Reboot Settings')),
				valueRow(_('Reboot Method'), rebootMethod)
			].concat(rebootRows.at, rebootRows.qmi, rebootRows.mbim, rebootRows.mmcli, rebootRows.custom, [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, []),
					E('div', { 'class': 'cbi-value-field' }, [
						E('button', {
							'class': 'btn cbi-button-remove',
							'click': function() { restartModem(ctx); }
						}, [ _('Restart Modem Now') ]),
						E('div', { 'class': 'cbi-value-description' }, [
							_('Restarts the modem using the method above, right now - useful if the eSIM channel gets stuck or the modem takes a long time to (re)initialize, independent of any profile enable/disable action.')
						])
					])
				])
			])),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'btn cbi-button-action', 'click': save }, [ _('Save') ])
			])
		]);

		updateBackendVisibility();
		updateTlsVisibility();
		updateRebootVisibility();

		return body;
	}
};

/* ==================== VIEW ==================== */

var TABS = [
	{ id: 'info', impl: InfoTab },
	{ id: 'profiles', impl: ProfilesTab },
	{ id: 'download', impl: DownloadTab },
	{ id: 'notifications', impl: NotificationsTab },
	{ id: 'config', impl: ConfigTab }
];

return view.extend({
	load: function() {
		return TABS[0].impl.load();
	},

	render: function(firstTabData) {
		var self = this;
		var tabLinks = {};
		var tabPanels = {};
		var activeId = TABS[0].id;

		var ctx = {
			reloadTab: function() { self.showTab(activeId, tabLinks, tabPanels); },
			reloadTabId: function(id) { self.showTab(id, tabLinks, tabPanels); },
			waitForModem: function() { self.waitForModem(tabLinks, tabPanels); }
		};
		self._ctx = ctx;

		var tabList = E('ul', { 'class': 'cbi-tabmenu' }, TABS.map(function(tab, i) {
			/* No href: an <a> only gets the browser's default link/visited
			   styling (blue text, underline) when it has one. Since this
			   never navigates anyway (click always calls preventDefault),
			   omitting href lets the theme's own .cbi-tabmenu li a color
			   rule apply cleanly instead of competing with link defaults. */
			var a = E('a', {
				'click': function(ev) {
					ev.preventDefault();
					self.showTab(tab.id, tabLinks, tabPanels);
				}
			}, [ tab.impl.title ]);
			var li = E('li', { 'class': i === 0 ? 'cbi-tab' : '' }, [ a ]);
			tabLinks[tab.id] = li;
			return li;
		}));

		TABS.forEach(function(tab) {
			tabPanels[tab.id] = E('div', { 'style': tab.id === activeId ? '' : 'display:none' }, [
				loadingSpinner()
			]);
		});

		tabPanels[activeId] = E('div', {}, [ TABS[0].impl.render(firstTabData, ctx) ]);

		return E('div', {}, [
			E('h2', {}, _('eSIM Profile Manager')),
			E('div', { 'class': 'cbi-map-descr' }, [ _('Manage eSIM profiles using lpac') ]),
			tabList,
			E('div', {}, TABS.map(function(tab) { return tabPanels[tab.id]; }))
		]);
	},

	showTab: function(id, tabLinks, tabPanels) {
		var self = this;

		Object.keys(tabLinks).forEach(function(tid) {
			tabLinks[tid].className = (tid === id) ? 'cbi-tab' : '';
		});
		Object.keys(tabPanels).forEach(function(tid) {
			tabPanels[tid].style.display = (tid === id) ? '' : 'none';
		});

		var tab = TABS.filter(function(t) { return t.id === id; })[0];
		var panel = tabPanels[id];

		while (panel.firstChild) panel.removeChild(panel.firstChild);
		panel.appendChild(loadingSpinner());

		tab.impl.load().then(function(data) {
			while (panel.firstChild) panel.removeChild(panel.firstChild);
			panel.appendChild(tab.impl.render(data, self._ctx));
		}).catch(function() {
			while (panel.firstChild) panel.removeChild(panel.firstChild);
			panel.appendChild(E('p', { 'class': 'cbi-section-descr' }, [ _('Failed to load this tab') ]));
		});
	},

	waitForModem: function(tabLinks, tabPanels) {
		var self = this;
		getJSON('status').then(function() {
			ui.hideModal();
			notifySuccess(_('Modem ready'), _('The modem has restarted successfully.'));
			self.showTab('profiles', tabLinks, tabPanels);
		}).catch(function() {
			window.setTimeout(function() { self.waitForModem(tabLinks, tabPanels); }, 5000);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
