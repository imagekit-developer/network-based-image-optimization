importScripts("https://storage.googleapis.com/workbox-cdn/releases/3.6.1/workbox-sw.js");

//the logic works only on whitelisted hosts.
//if you serve images from some other domain, add that here
var whitelistedHosts = ["ik.imagekit.io"];

var connectionTypesArr = ["4g", "3g", "2g", "slow-2g"];
var defaultConnectionType = "3g";
var maxAge = {
    "ik-4g" : 2592000,
    "ik-3g" : 604800,
    "ik-2g" : 604800,
    "ik-slow-2g" : 604800
};
var maxCacheEntries = {
    "ik-4g" : 500,
    "ik-3g" : 500,
    "ik-2g" : 500,
    "ik-slow-2g" : 500
};

//formats that are classified as image url
var imageURLRegex = /\.(png|jpg|jpeg|gif|webp)/;

//regex to match if there is an existing quality parameter in the URL
var qualityRegex = /(?:^|,)q\-(auto_high|auto_low|auto|[0-9]+)/;

//query parameter for transform
var transformParameter = "tr";

//clear cache in 60 seconds
var cacheExpiryTimeout = 60000;

/*
    Transformations to be applied based on network type.
    Ideally, we need only "q" parameter to change quality, but here we are adding
    overlay parameters as well to get an overlay as well indicating quality
*/
var netConfig = {
    "slow-2g" :  {
        "q" : "40",
        "ot" : "40",
        "ots" : "40",
        "otc" : "FF00A0",
        "ox" : "10",
        "oy" : "10"
    },
    "2g" : {
        "q" : "50",
        "ot" : "50",
        "ots" : "40",
        "otc" : "FF00A0",
        "ox" : "10",
        "oy" : "10"
    },
    "3g" : {
        "q" : "70",
        "ot" : "70",
        "ots" : "40",
        "otc" : "FF00A0",
        "ox" : "10",
        "oy" : "10"
    },
    "4g" : {
        "q" : "90",
        "ot" : "90",
        "ots" : "40",
        "otc" : "FF00A0",
        "ox" : "10",
        "oy" : "10"
    }
};

var expirationManagers = [];
self.addEventListener("install", function(event) {
    //create expiry managers, and set interval for cache clear.
    //each expiry manager has a different cache time
    expirationManagers = instantiateExpirationManagers();
    setInterval(expireCaches, cacheExpiryTimeout);
});

/*
    Triggered on every request that originates from the browser
*/
self.addEventListener("fetch", function(e) {
    if (!(
        e && e.request && e.request.url
    )) {
        return;
    }

    if(e.request.referrer 
            && (e.request.referrer.indexOf("/demo/sw-opt-1") == -1 
            && e.request.referrer.indexOf("/demo/sw-opt-2") == -1)
    ) {
        return;
    }

    if(!e.request.url.match(imageURLRegex)) {
        return;
    }

    /*
        For lower speed presets in chrome, the effectiveType is 4G while the downlink is a very small number.
        "downlink" is the theoretical maximum. So we change the effective connection type to use 3G settings in 
        such cases.
    */
    var connectionType = navigator.connection.effectiveType;
    if(!connectionType || (connectionType == "4g" && navigator.connection.downlink < 1)) {
        connectionType = defaultConnectionType;
    }
    
    var transformConfig = netConfig[connectionType] || {};
    
    var url = new URL(e.request.url);
    if(whitelistedHosts.indexOf(url.host) != -1) {
        var returnURL = updateURL(url, stringifyTransform(transformConfig));
        e.respondWith(
            stepdownCacheLookup(caches, e.request, returnURL, connectionTypesArr.slice(), connectionType)
        );
    }
});


function stepdownCacheLookup(caches, request, returnURL, steps, connectionType) {
    var step = steps.splice(0,1);
    if(!step[0]) {
        return fetch(returnURL).then(function(netResponse) {
            return netResponse;
        });
    }

    var cacheName = getCacheName(step[0]);
    return caches.open(cacheName).then(function(cache) {
        return cache.match(request).then(function(response) {
            if(response) return response;

            //if we have more steps remaining and we havent reached the cache for current connection type
            if(steps.length && step[0] !== connectionType) {
                return stepdownCacheLookup(caches, request, returnURL, steps, connectionType);
            } else {
                return fetch(returnURL).then(function(netResponse) {
                    if(netResponse && netResponse.status == 200) {
                        cache.put(request, netResponse.clone());
                        expirationManagers[cacheName].updateTimestamp(request.url);
                    }
                    
                    return netResponse;
                });
            }
        });
    });
}

function getCacheName(step) {
    return "ik-" + step;
}


function stringifyTransform(transformConfig) {
    var transform = [];
    for(var i in transformConfig) {
        transform.push([i,transformConfig[i]].join("-"));
    }

    return transform.join(",");
}


/*
    Works for transformation string in query parameters only
    If you are using path parameters for transformation, then you need to modify this function
*/
function updateURL(url, str) {
    var existingTransform = url.searchParams.get(transformParameter);
    if(existingTransform) {
        if(qualityRegex.test(existingTransform)) {
            url.searchParams.set(transformParameter, existingTransform.replace(qualityRegex, "," + str));
        } else {
            url.searchParams.set(transformParameter, [existingTransform, str].join(","));
        }
        
    } else {
        url.searchParams.set(transformParameter, str);
    }

    url.searchParams.set("ik-sw-no-cache", "true");

    return url.href;
}

function instantiateExpirationManagers() {
    var cacheTypes = connectionTypesArr.slice();
    var managers = [];
    for(var i = 0; i < cacheTypes.length; i++) {
        var cacheName = getCacheName(cacheTypes[i]);
        var expirationManager = new workbox.expiration.CacheExpiration(
            cacheName, {
                maxAgeSeconds: maxAge[cacheName],
                maxEntries: maxCacheEntries[cacheName],
            }
        );
        managers[cacheName] = expirationManager;
    }

    return managers;
}

function expireCaches() {
    for(var i in expirationManagers) {
        if(!expirationManagers[i] || !expirationManagers[i].expireEntries) continue;
        expirationManagers[i].expireEntries();
    }
}