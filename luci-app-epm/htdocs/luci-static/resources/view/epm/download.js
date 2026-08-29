'use strict';
'require view';
'require ui';
'require view.epm.common as common';

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

return view.extend({
	load: function() {
		return Promise.resolve(null);
	},

	render: function() {
		common.ensurePageHeader();

		var qrCode = E('input', { 'type': 'hidden' });
		var qrPreview = E('img', { 'style': 'max-width:300px;max-height:200px;display:none;border:1px solid var(--border-color-medium,#ccc);border-radius:4px' });
		var qrStatus = E('p', { 'class': 'cbi-section-descr' }, []);
		var qrFile = E('input', { 'type': 'file', 'accept': 'image/*', 'class': 'cbi-input-file' });

		var smdp = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': 'rsp.example.com' });
		var actCode = E('input', { 'type': 'text', 'class': 'cbi-input-text' });
		var confCode = E('input', { 'type': 'text', 'class': 'cbi-input-text' });

		var resultBox = E('div', {});

		/* Show what lpac actually did, not just the final outcome. A profile
		   download goes through several ES9+ steps (initiate authentication,
		   authenticate client, get bound profile package, ...) before the
		   final result - previously the backend only kept the last one, so a
		   failure partway through looked identical to "nothing happened" and
		   the whole page just sat there loading. epm.lua now returns every
		   step it saw (see parse_lpac_output()); render them here as a
		   readable log, plus the raw JSON for anyone who wants the details. */
		function renderSteps(steps) {
			while (resultBox.firstChild) resultBox.removeChild(resultBox.firstChild);

			if (!steps || !steps.length) return;

			var list = E('ul', { 'style': 'list-style:none;margin:10px 0;padding:0' });
			steps.forEach(function(step) {
				var payload = step.payload || {};
				var ok = payload.code === undefined || payload.code === 0;
				var label = payload.message || step.type || _('step');
				if (payload.data && typeof payload.data === 'string' && payload.data !== label) {
					label += ' - ' + payload.data;
				}
				list.appendChild(E('li', { 'style': 'padding:3px 0;font-family:monospace;font-size:12px' }, [
					E('span', { 'style': 'color:' + (ok ? 'var(--success-color,#28a745)' : 'var(--danger-color,#dc3545)') }, [ ok ? '✓ ' : '✗ ' ]),
					label
				]));
			});

			var details = E('details', {}, [
				E('summary', { 'style': 'cursor:pointer;font-size:12px' }, [ _('Raw output') ]),
				E('pre', { 'style': 'white-space:pre-wrap;font-size:11px' }, [ JSON.stringify(steps, null, 2) ])
			]);

			resultBox.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('What happened')),
				list,
				details
			]));
		}

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
				common.notifyError(_('Error'), _('Enter a server and activation code, or upload a QR code image'));
				return;
			}
			if (confCode.value.trim()) params.confirmation_code = confCode.value.trim();

			var elapsed = 0;
			var elapsedLabel = E('span', {}, [ '0s' ]);
			var timer = window.setInterval(function() {
				elapsed++;
				elapsedLabel.textContent = elapsed + 's';
			}, 1000);

			ui.showModal(_('Downloading Profile'), [
				E('p', { 'class': 'spinning' }, [
					_('Talking to the SM-DP+ server, this can take up to a minute…'), ' (', elapsedLabel, ')'
				])
			]);

			common.postForm('download', params).then(function(data) {
				window.clearInterval(timer);
				ui.hideModal();
				renderSteps(data.steps);

				if (data.type === 'lpa' && data.payload && data.payload.code === 0) {
					common.notifySuccess(_('Success'), data.payload.message || _('Profile downloaded successfully'));
					qrCode.value = '';
					qrFile.value = '';
					qrPreview.style.display = 'none';
					smdp.value = '';
					actCode.value = '';
					confCode.value = '';
					qrStatus.textContent = '';
					resultBox.appendChild(E('p', {}, [
						E('a', { 'href': common.pageUrl('profiles') }, [ _('Go to Profiles to enable the new profile') + ' →' ])
					]));
				} else {
					common.notifyError(_('Download failed'), common.lpaErrorMessage(data));
				}
			}).catch(function() {
				window.clearInterval(timer);
				ui.hideModal();
				common.notifyError(_('Error'), _('Failed to download profile'));
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
				E('button', { 'type': 'button', 'class': 'btn cbi-button-action', 'click': submit }, [ _('Download Profile') ])
			]),
			resultBox
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
