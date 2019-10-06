'use strict';

(function () {
	'use strict';

	var inBrowserHost = 'http://localhost:8080';
	var apiBase = '/api/v1/memes/';

	var defaultTop = 'Can\'t think of a meme?';
	var defaultBottom = 'Why not Zoidberg?';

	var top = document.getElementById('input-top');
	var bottom = document.getElementById('input-bottom');
	var button = document.getElementById('create-button');
	var remoteId = document.getElementById('remote-id');

	var img = document.getElementById('meme-img');
	var perfOut = document.getElementById('perf-out') || {};

	var md = new MobileDetect(window.navigator.userAgent);

	function hasParam(name) {
		return location.search.indexOf(name) >= 0;
	}

	var inBrowser = false;

	function setInBrowser(b) {
		inBrowser = b;
		remoteId.innerHTML = b ? 'in-browser' : 'remote';
	}

	if (!md.mobile() || hasParam('force-clientside')) setInBrowser(true);
	if (hasParam('force-remote')) setInBrowser(false);

	var inBrowserStarted = false;
	var inBrowserReady = false;
	// for any requests that are pending while browsix server
	// starts up
	var inBrowserQueue = [];

	var kernel = null;

	function remoteRequest(url, cb) {
		var request = new XMLHttpRequest();
		request.open('GET', url, true);
		request.responseType = 'blob';
		request.onload = cb;
		request.onerror = function () {
			// if the request failed, and we haven't
			// already switched to targeting Browsix, do
			// so now.
			if (!inBrowser) {
				console.log('switching to in-browser backend');
				setInBrowser(true);
				inBrowserRequest(url, cb);
			} else {
				console.log('xhr failed');
			}
		};
		request.send();
	}

	function inBrowserRequest(url, cb) {
		if (!inBrowserReady) {
			inBrowserQueue.push([url, cb]);
			if (!inBrowserStarted) startBrowsix();
			return;
		}
		kernel.httpRequest(inBrowserHost + url, cb);
	}

	var requestDuration = 0;

	function memeRequest(url, cb) {
		var startTime = performance.now();
		var start = 0;
		if (url && url.length && url[0] === '/') start = 1;

		var request = inBrowser ? inBrowserRequest : remoteRequest;
		request(apiBase + url.substring(start), function () {
			requestDuration = performance.now() - startTime;
			// console.log('took ' + requestDuration + ' ms')
			cb.apply(this);
		});
	}

	function onInBrowserReady() {
		inBrowserReady = true;
		for (var params = inBrowserQueue.shift(); params; params = inBrowserQueue.shift()) {
			inBrowserRequest.apply(this, params);
		}
	}

	function startBrowsix() {
		window.Boot('XmlHttpRequest', ['index.json', 'fs', true], function (err, k) {
			if (err) {
				console.log(err);
				throw new Error(err);
			}
			kernel = k;
			startServer();
		}, { readOnly: true });
	}

	function startServer() {
		function onStdout(pid, out) {
			console.log(out);
		}
		function onStderr(pid, out) {
			console.log(out);
		}
		function onExit(pid, code) {
			console.log('exited: ' + pid + ' with code ' + code);
		}
		kernel.once('port:8080', onInBrowserReady.bind(this));
		kernel.system('/meme-service.js -bgdir=img -fontfile=font/impact.ttf', onExit, onStdout, onStderr);

		// explicitly leak kernel for debugging purposes
		window.kernel = kernel;
	}

	function clicked() {
		var topVal = top.value;
		var bottomVal = bottom.value;

		$(button).toggleClass('is-active').blur();

		if (!topVal && !bottomVal) {
			topVal = defaultTop;
			bottomVal = defaultBottom;
		}

		var topEnc = encodeURIComponent(topVal.toUpperCase());
		var bottomEnc = encodeURIComponent(bottomVal.toUpperCase());

		var bgSelect = document.getElementById('bg');
		var image = bgSelect.options[bgSelect.selectedIndex].value;

		var url = image + '?top=' + topEnc + '&bottom=' + bottomEnc;

		var start = performance.now();
		function completed(e) {
			if (e) {
				console.log('inBrowser call failed:');
				console.log(e);
			} else if (this.status === 200) {
				var blob = new Blob([this.response], { type: 'image/png' });
				var blobUrl = window.URL.createObjectURL(blob);
				img.src = blobUrl;

				var totalTime = '' + (performance.now() - start) / 1000;
				var dot = totalTime.indexOf('.');
				if (dot + 4 < totalTime.length) {
					totalTime = totalTime.substr(0, dot + 4);
				}
				perfOut.innerHTML = totalTime;
			} else {
				console.log('inBrowser call failed for unknown reason');
			}
		}

		memeRequest(url, function (e) {
			if (this.status === 200) {

				var blob = new Blob([this.response], { type: 'image/png' });
				var _url = window.URL.createObjectURL(blob);
				img.src = _url;
			} else {
				console.log('bad response: ' + this.status);
				debugger;
			}
			$(button).toggleClass('is-active');
		});
	}

	function optionsReady(reader) {
		var s = String.fromCharCode.apply(null, new Uint8Array(reader.result));
		var result = JSON.parse(s);
		var names = _.map(result, function (bg) {
			return bg.name;
		});
		// ensure a stable, reverse-alphabetical order
		names.sort();
		names.reverse();
		var html = _.reduce(names, function (all, n) {
			return all + '<option>' + n + '</option>\n';
		}, '');
		document.getElementById('bg').innerHTML = html;
		button.disabled = false;

		setTimeout(timingTest, 1000);
	}

	var durations = [];
	var run = 0;
	var nWarmup = 20;
	var nTest = 100;

	function timingTest() {
		memeRequest('/', function (e) {
			if (this.status === 200) {
				run++;
				if (run <= nWarmup) {
					setTimeout(timingTest, 10);
				} else {
					durations.push(requestDuration);
					if (run <= nTest + nWarmup) {
						setTimeout(timingTest, 10);
					} else {
						console.log(JSON.stringify(durations));
						remoteId.innerHTML = 'done';
					}
				}
			} else {
				console.log('bad response: ' + this.status);
				debugger;
			}
		});
	}

	memeRequest('/', function (e) {
		if (this.status === 200) {
			// need to use a filereader for now to get at
			// the results, as we asked for a blob.
			var reader = new FileReader();
			reader.addEventListener("loadend", optionsReady.bind(this, reader));
			reader.readAsArrayBuffer(this.response);
		} else {
			console.log('bad response: ' + this.status);
			debugger;
		}
	});
	window.memeRequest = memeRequest;

	button.addEventListener('click', clicked);

	window.onload = function () {
		// if ('serviceWorker' in navigator) {
		// 	navigator.serviceWorker.register('/sw.js?v7', { scope: '/' }).then(function(reg) {

		// 		if(reg.installing)
		// 			console.log('Service worker installing');
		// 		else if(reg.waiting)
		// 			console.log('Service worker installed');
		// 		else if(reg.active)
		// 			console.log('Service worker active');

		// 	}).catch(function(error) {
		// 		// registration failed
		// 		console.log('Registration failed with ' + error);
		// 	});
		// };
	};
})();
//# sourceMappingURL=main.js.map
