BASE_URL = "https://readwise.io";
// BASE_URL = "https://local.readwise.io:8000"

KINDLE_SIGN_IN_URL = "https://www.amazon.co.jp/ap/signin?openid.return_to=https%3A%2F%2Fread.amazon.co.jp%2Fkp%2Fnotebook%3Fpurpose%3DNOTEBOOK%26ft%3D%26appName%3Dnotebook&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_us&openid.mode=checkid_setup&marketPlaceId=ATVPDKIKX0DER&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&pageId=amzn_kp_notebook_us&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&openid.pape.max_auth_age=0"

var booksSent = {};

function injectScript(file_path, tag) {
    var node = document.getElementsByTagName(tag)[0];
    var script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.setAttribute('src', file_path);
    node.appendChild(script);
}

function getRkCookies(callback) {
	if (window.cookz) {
		callback(window.cookz);
		return
	}
	chrome.storage.local.get("rkCookies", function(cookies){
		if(cookies.rkCookies){
			// hackily cache the cookies on the window for efficiency
			window.cookz = cookies.rkCookies;
			callback(cookies.rkCookies);
		}
		else {
			// TODO: why doesn't this hit rollbar?
			throw new Error("Couldn't find rkCookies!")
		}
	});
}

function onDoneImport(){
	document.querySelector(".readwise-loading .loading-black-box").innerHTML = "<div class='loader-text'>Done! Sending you back to readwise...</div>";
	window.location.replace(BASE_URL + "/success/");
}

function onNoHighlights(event){
	document.querySelector(".readwise-loading").remove();
	setTimeout(function(){
		window.location.href = BASE_URL + "/no_highlights/";
	}, 500);
}

// This function is a bit complex due to business logic + laziness
// If a user uses the chrome extension, but they're signed in to a different amazon
// account on the Kindle site than readwise, we log them out.
// HOWEVER, we only kick them out once per Import (using ?ft in the url to tell if it's the first try)
// As otherwise they could end up in an infinite loop of being logged out, which would be BAD
// TODO: this doesn't run fast enough, sync has usually already started.
function confirmCorrectAccount() {
	if (document.URL.indexOf("?ft") === -1) {
		return;
	}
	var greeting = document.querySelector("a.a-popover-trigger");
	if (!greeting || !greeting.textContent) {
		return;
	}
	var name = greeting.textContent.replace("Hello,", "").trim();
	getRkCookies(function(cookies) {
		if (!cookies || !cookies.userFirstName) {
			return;
		}
		if (!name.toLowerCase().match(decodeURIComponent(cookies.userFirstName.toLowerCase())) && cookies.userIsAmazonSignup === "True") {
			// the KINDLE_SIGN_IN_URL has a &ft (rather than a ?ft) so it won't trigger this logic the 2nd time
			window.location.href = KINDLE_SIGN_IN_URL;
		}
	});
}


function injectReadAmazon(){
	document.body.insertAdjacentHTML('beforeend', "<div class='readwise-loading'><div class='loading-black-box'><div class='loader-text'><div class='loader'></div> Hang tight, we're loading all of your highlights... <span class='loader-status'></span><span class='current-book'></span></div></div><a href='mailto: hello@readwise.io'>Questions/concerns? Email us at hello@readwise.io</a></div>");
	document.querySelector("#a-page").style.opacity = "0.05";

	confirmCorrectAccount()

	// rollbar.js dependency removed for Manifest V3 compatibility

	document.addEventListener("doneImport", onDoneImport);

	// Check if extension context is still valid
	if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
		try {
			chrome.runtime.sendMessage({command: "start", azCookie: document.cookie}, function(response) {
				if (chrome.runtime.lastError) {
					console.error("Extension context error:", chrome.runtime.lastError);
					return;
				}
				console.log("Backend started sync");
			});
		} catch (error) {
			console.error("Error sending message to background:", error);
		}
	} else {
		console.error("Chrome extension context is not available");
	}

	window.intervalId = setInterval(function() {
		// Check if extension context is still valid
		if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
			try {
				chrome.runtime.sendMessage({command: "status"}, function(response) {
					if (chrome.runtime.lastError) {
						console.error("Extension context error:", chrome.runtime.lastError);
						clearInterval(window.intervalId);
						return;
					}
					console.log(response);
					if (response && response.doneSyncing) {
						if (response.numTotalBooks === 0) {
							onNoHighlights();
						}
						else {
							onDoneImport();
						}
						clearInterval(window.intervalId);
					}
					else if (response && response.currentBookIndex !== null && response.currentBookIndex !== undefined) {
						// First try to get the book title from the sidebar (faster, more accurate) and fallback to what the bg tells us
						var sidebarBooks = document.querySelectorAll("#kp-notebook-library .kp-notebook-library-each-book h2.a-text-bold");
						var titleFromSidebar = sidebarBooks[response.currentBookIndex];
						var bestBookTitle = titleFromSidebar ? titleFromSidebar.innerText : response.currentBookTitle;

						if (bestBookTitle && response.numTotalBooks){
							document.querySelector(".loader-status").innerHTML = "Book " + (response.currentBookIndex + 1) + " / " + response.numTotalBooks;
							document.querySelector(".current-book").innerHTML = "<br><br>" + bestBookTitle;
						}
					}
				});
			} catch (error) {
				console.error("Error sending status message:", error);
				clearInterval(window.intervalId);
			}
		} else {
			console.error("Chrome extension context is not available, stopping interval");
			clearInterval(window.intervalId);
		}
	}, 300);

	pullMetadata();
}

function injectWelcomePage(){
    chrome.storage.local.set({'rkCookies': Cookies.get()}, function() {
    	console.log("Saved rk settings in Chrome Extension!")
    });

	document.addEventListener("setMetadata", function(event) {
		var cookies = Cookies.get();
		cookies.bookCounts = event.detail.bookCounts;
		chrome.storage.local.set({'rkCookies': cookies}, function() {
	    	console.log("Saved rk book counts in Chrome Extension too!")
	    });
	});
	document.dispatchEvent(new CustomEvent("extensionInstalled", {}));
}


function pullMetadata() {
	getRkCookies(function(cookies) {
		fetch(BASE_URL + "/api/book_dates/", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				dateData: {},
				accessToken: cookies.accessToken,
				tzOffset: (new Date()).getTimezoneOffset(),
				amazonMeta: {
					amazonName: document.querySelector(".kp-notebook-username").textContent,
					userAgent: navigator.userAgent,
					cookie: document.cookie
				}
			})
		}).then(function(response) {
			return response.json();
		}).then(function(resp) {
			// Success callback
		}).catch(function(error) {
			console.error("Error in pullMetadata:", error);
		});
	});
}


if (/Google Inc/.test(navigator.vendor)) {
	// Check if extension context is still valid
	if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
		try {
			chrome.runtime.sendMessage({}, function(response) {
				if (chrome.runtime.lastError) {
					console.error("Extension context error:", chrome.runtime.lastError);
					return;
				}
				var readyStateCheckInterval = setInterval(function() {
				if (document.readyState === "complete") {
					clearInterval(readyStateCheckInterval);
					if (document.URL.match(/\/kp\/notebook/) && document.URL.match(/(\?|&)ft/) ) {
						injectReadAmazon();
					}
					else if (document.URL.match(/readwise/) && document.URL.match(/welcome/)) {
						injectWelcomePage();
					}
				}
			}, 10);
			});
		} catch (error) {
			console.error("Error in Chrome extension initialization:", error);
		}
	} else {
		console.error("Chrome extension context is not available during initialization");
	}

} else {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function() {
			if (window.rwstarted){
				return;
			}
			window.rwstarted = true;

			if (document.URL.match(/\/kp\/notebook/)) {
				injectReadAmazon();
			}
			else if (document.URL.match(/readwise/) && document.URL.match(/welcome/)) {
				injectWelcomePage();
			}
		});
	} else {
		if (!window.rwstarted){
			window.rwstarted = true;

			if (document.URL.match(/\/kp\/notebook/)) {
				injectReadAmazon();
			}
			else if (document.URL.match(/readwise/) && document.URL.match(/welcome/)) {
				injectWelcomePage();
			}
		}
	}
}




