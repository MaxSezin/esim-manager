'use strict';
'require view';
'require view.epm.common as common';

return view.extend({
	load: function() {
		return common.getJSON('config');
	},

	render: function(data) {
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

			common.postForm('saveconfig', { config: JSON.stringify({ epm: epmConfig }) }).then(function(res) {
				if (res.success) {
					common.notifySuccess(_('Saved'), res.message || _('Configuration saved successfully'));
				} else {
					common.notifyError(_('Error'), res.error || _('Failed to save configuration'));
				}
			}).catch(function() { common.notifyError(_('Error'), _('Failed to save configuration')); });
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
							'click': common.restartModem
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
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
