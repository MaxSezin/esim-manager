'use strict';
'require view';
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

			ui.showModal(_('Downloading Profile'), [
				E('p', { 'class': 'spinning' }, [ _('This can take up to a minute…') ])
			]);

			common.postForm('download', params).then(function(data) {
				ui.hideModal();
				resultBox.appendChild(E('pre', { 'style': 'white-space:pre-wrap;font-size:11px' }, [ JSON.stringify(data, null, 2) ]));

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
				E('button', { 'class': 'btn cbi-button-action', 'click': submit }, [ _('Download Profile') ])
			]),
			resultBox
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
