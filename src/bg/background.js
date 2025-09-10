const BASE_URL = "https://readwise.io";
// const BASE_URL = "https://local.readwise.io:8000"

const AUTHOR_SELECTOR = "p.kp-notebook-metadata.a-spacing-none"

function sendLog(message) {
  console.log("LOG: " + message)
  getRkCookies(function (cookies) {
    postRequest('/api/log/', {
      message: message,
      time: Date.now(),
      accessToken: cookies.accessToken,
      userEmail: cookies.userEmail,
      uniqueSyncId: globalState.uniqueSyncId,
    })
  });
}


// Global state for service worker
let globalState = {
  cookz: null,
  startedSyncing: null,
  doneSyncing: false,
  currentBookIndex: null,
  syncedBookHashes: [],
  isForcedSync: false,
  uniqueSyncId: null,
  errorCount: 0,
  maxErrors: 3,
  newPullRemainingBookIdsCalled: false,
  retryAttempted: false
};

function getRkCookies(callback, forceRefresh) {
  if (globalState.cookz && globalState.cookz.accessToken && !forceRefresh) {
    callback(globalState.cookz);
    return;
  }

  // If we didn't have the rw cookies cached, get them from chrome
  var cookieDomain;
  if (BASE_URL.indexOf("local") !== -1) {
    cookieDomain = ".local.readwise.io";
  } else {
    cookieDomain = ".readwise.io";
  }

  chrome.cookies.getAll({url: BASE_URL, domain: cookieDomain}, function (cookies) {
    globalState.cookz = {};
    cookies.forEach(function (c) {
      globalState.cookz[c.name] = c.value;
    });

    if (globalState.cookz.accessToken) {
      callback(globalState.cookz);
    } else {
      // then try pulling the cookies from the chrome local storage
      chrome.storage.local.get("rkCookies", function (storageCookies) {
        if (storageCookies.rkCookies) {
          globalState.cookz = storageCookies.rkCookies;
          return callback(globalState.cookz);
        } else {
          // final failure: we have no cookies
          return callback({});
        }
      });
    }
  });
}

function onDoneSync() {
  globalState.startedSyncing = null;
  globalState.doneSyncing = true;
  sendLog("Done sync, a total of " + (globalState.currentBookIndex + 1) + " books covered before finishing.");
  chrome.storage.local.set({lastSync: {status: "success", time: Date.now()}});
  setLocalStorageKey("syncedBookHashes", JSON.stringify(globalState.syncedBookHashes));
}


function isMismatchedAmazonAccount(greeting) {
  if (globalState.isForcedSync) {
    return false;
  }

  var cookieName = globalState.cookz && globalState.cookz.userAmazonName ? decodeURIComponent(globalState.cookz.userAmazonName) : "";

  var misMatch = greeting && (greeting !== cookieName);
  if (misMatch) {
    sendLog("Ending sync early because amazon account does not seem to match: " + cookieName + " vs. " + greeting);
  }
  return misMatch
}

function onInitialRequestError(error) {
  sendLog("Ending sync early because initial /notebook request failed -- user is probably logged out? Error: " + error);
  if (globalState.cookz) {
    postRequest('/api/extension_logged_out/', {accessToken: globalState.cookz.accessToken, userEmail: globalState.cookz.userEmail});
  }
  chrome.storage.local.set({lastSync: {status: "loggedOut"}});
}


// start shared code here: ----------------------------------------------------


function setLocalStorageKey(key, value, retry=true){
  try {
    chrome.storage.local.set({[key]: value})
    return
  } catch (e) {
    sendLog(`Local storage error: ${e}. Clearing all of the storage...`)
    chrome.storage.local.clear()
    if (retry) {
      setLocalStorageKey(key, value, retry = false)
    } else {
      throw Error(`Error setting a key in localStorage: ${e}. User email: ${globalState.cookz ? globalState.cookz.userEmail : 'unknown'}`)
    }
  }
}

function postRequest(url, data, onSuccess, onError) {
  fetch(BASE_URL + url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(data)
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.text().then(text => {
      try {
        return JSON.parse(text);
      } catch (e) {
        console.error("JSON parse error:", e, "Response text:", text.substring(0, 200));
        throw new Error("Invalid JSON response");
      }
    });
  })
  .then(resp => {
    if (onSuccess) {
      onSuccess.call(this, resp);
    }
  })
  .catch(error => {
    console.error("postRequest error:", error);
    if (onError) {
      onError.call(this, error);
    }
  });
}

// get uses the fetch API (promise-based), despite postRequest using AJAX
function getRequest(url) {
  return fetch(url, {
    headers: globalState.requestHeaders,
    credentials: 'include',  // Include cookies for authentication
  }).then(function (response) {
    if (!response.ok) {
      throw Error(response.statusText);
    }
    return response.text();
  });
}

function afterSendBookData(isLastBook) {
  if (isLastBook) {
    onDoneSync();
  } else {
    pullNextBook();
  }
}

function sendBookData(bookData, cookies, lastBook) {
  // Convert bookData to Readwise API v2 format
  var highlights = [];
  var bookId = globalState.currentBookId;
  var book = bookData[bookId];
  
  if (book && book.quotes) {
    Object.keys(book.quotes).forEach(function(location, index) {
      var quote = book.quotes[location];
      highlights.push({
        text: quote.text,
        title: book.title,
        author: book.author,
        source_type: "kindle_extension",
        category: "books",
        location: index + 1, // Use sequential integer (1, 2, 3, ...)
        location_type: "order",
        note: quote.note || null,
        color: quote.color || "yellow",
        highlighted_at: new Date().toISOString()
      });
    });
  }

  let payload = JSON.stringify({
    highlights: highlights
  });

  let hashedPayload = hashString(payload)
  console.log("Converted payload for Readwise API v2:", JSON.stringify(payload, null, 2));
  console.log("Hashed payload:", hashedPayload);
  
  let bookMatchesPreviousSync = globalState.syncedBookHashes.includes(hashedPayload) && !globalState.isForcedSync;
  if (bookMatchesPreviousSync || highlights.length === 0) {
    // Skip sending if we've already sent exactly the same data or it's a book with no highlights
    console.log("Skipping book: " + book.title)
    afterSendBookData(lastBook);
    return
  }

  console.log("Sending " + globalState.currentBookId + " (" + book.title + ") with " + highlights.length + " highlights");
  
  // Use the correct Readwise API v2 endpoint
  var apiEndpoint = BASE_URL + "/api/v2/highlights/";
  console.log("Using Readwise API v2 endpoint:", apiEndpoint);
  
  fetch(apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Token " + cookies.accessToken
    },
    body: payload
  })
  .then(response => {
    console.log("Readwise API v2 response status:", response.status);
    console.log("Readwise API v2 response headers:", response.headers);
    
    if (!response.ok) {
      return response.text().then(text => {
        console.error("Readwise API v2 error response:", text);
        throw new Error(`HTTP error! status: ${response.status}, response: ${text}`);
      });
    }
    return response.json();
  })
  .then(resp => {
    console.log("Readwise API v2 success response:", resp);
    console.log("Sent successfully. Saving hash to local storage...")
    globalState.syncedBookHashes.push(hashedPayload)
    afterSendBookData(lastBook);
  })
  .catch(error => {
    console.error("Error sending book data to Readwise API v2:", error);
    console.error("Book ID:", globalState.currentBookId);
    console.error("Book title:", book.title);
    console.error("Number of highlights:", highlights.length);
    
    // Check if this is a 500 error and we haven't retried yet
    if ((error.message.includes("500") || error.message.includes("Failed to fetch")) && !globalState.retryAttempted) {
      console.log("500 error or network error detected, retrying once...");
      globalState.retryAttempted = true;
      
      // Wait 3 seconds before retry
      setTimeout(() => {
        console.log("Retrying send for book:", globalState.currentBookId);
        // Reset retry flag before retrying
        globalState.retryAttempted = false;
        // Call the retry function instead of recursively calling sendBookData
        retrySendBookData(bookData, cookies, lastBook);
      }, 3000);
      return;
    }
    
    console.log("Sent with error.")
    afterSendBookData(lastBook);
  });
}

function retrySendBookData(bookData, cookies, lastBook) {
  console.log("Retrying send for book:", globalState.currentBookId);
  
  // Convert bookData to Readwise API v2 format
  var highlights = [];
  var bookId = globalState.currentBookId;
  var book = bookData[bookId];
  
  if (book && book.quotes) {
    Object.keys(book.quotes).forEach(function(location, index) {
      var quote = book.quotes[location];
      highlights.push({
        text: quote.text,
        title: book.title,
        author: book.author,
        source_type: "kindle_extension",
        category: "books",
        location: index + 1, // Use sequential integer (1, 2, 3, ...)
        location_type: "order",
        note: quote.note || null,
        color: quote.color || "yellow",
        highlighted_at: new Date().toISOString()
      });
    });
  }

  let payload = JSON.stringify({
    highlights: highlights
  });

  // Use the correct Readwise API v2 endpoint
  var apiEndpoint = BASE_URL + "/api/v2/highlights/";
  console.log("Retrying with Readwise API v2 endpoint:", apiEndpoint);
  
  fetch(apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Token " + cookies.accessToken
    },
    body: payload
  })
  .then(response => {
    console.log("Retry - Readwise API v2 response status:", response.status);
    
    if (!response.ok) {
      return response.text().then(text => {
        console.error("Retry - Readwise API v2 error response:", text);
        throw new Error(`HTTP error! status: ${response.status}, response: ${text}`);
      });
    }
    return response.json();
  })
  .then(resp => {
    console.log("Retry - Readwise API v2 success response:", resp);
    console.log("Retry successful. Saving hash to local storage...")
    let hashedPayload = hashString(payload);
    globalState.syncedBookHashes.push(hashedPayload)
    afterSendBookData(lastBook);
  })
  .catch(error => {
    console.error("Retry failed for book data to Readwise API v2:", error);
    console.log("Retry failed, continuing with next book.")
    afterSendBookData(lastBook);
  });
}