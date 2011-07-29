/**
 *
 **/

define(
  [
    'fs', 'path', 'util',
    'q',
    'apac',
    'redis',
    'exports'
  ],
  function(
    $fs, $path, $util,
    $Q,
    $apac,
    $redis,
    exports
  ) {
var when = $Q.when;

/*
 * Expected useful links:
 *
 * Finding
 *   http://www.a2sdeveloper.com/page-how-can-i-find-other-cds-or-mp3-downloads-by-the-same-artist.html
 */
//

exports.REL_ARTIST = 'DigitalMusicPrimaryArtist';
exports.REL_TRACKS = 'Tracks';

exports.SORT_RELEVANCE = 'relevancerank';

/**
 * Hold old can data be and still be useful?  We are using 3 days right now for
 *  development purposes, but in production cases this would need to be shorter.
 * NB: The product API has various clauses that may affect this, especially if
 *  prices are being displayed.  We don't display prices and so our validity
 *  concerns are rather lower.
 */
const MAX_DATA_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * We are only supposed to issue 1 query-per-second, per-user-ish.  I'm not
 *  clear on whether if we are a server acting on behalf of N users we can do
 *  N per second, or it's still 1-per-second.  The thing I read suggested if
 *  we distribute a binary app a users runs, that app better damn well make sure
 *  it only issues 1-per-second.
 * I'll figure this out later since in dev mode it's just me and I am just one
 *  user!
 */
const THROTTLE_MS = 1000;

/**
 * Amazon product-API interacting logic, responsible for query rate-limiting,
 *  aggregation, and caching.
 */
function Searcher() {
  // XXX synchronously load our secrets
  var secretPath = $path.join(process.env['HOME'], '.amazon-creds.json');
  var secretsStr = $fs.readFileSync(secretPath, 'utf8');
  var secrets = JSON.parse(secretsStr);

  this._opHelper = new $apac.OperationHelper(secrets);

  /** Throttled queries. */
  this._queryQueue = [];
  this._activeTimeout = null;

  this._redis = $redis.createClient(6379, '127.0.0.1');
  this._redis.select(15);

  this._searchIndex = 'MP3Downloads';
  this._searchResponseGroups = 'ItemAttributes,Images,RelatedItems';
}
exports.Searcher = Searcher;
Searcher.prototype = {
  _pickoutArg: function(respObj, argName) {
    var args = respObj.OperationRequest.Arguments.Argument;
    for (var i = 0; i < args.length; i++) {
      if (args[i]['@'].Name === argName) {
        return args[i]['@'].Value;
      }
    }
    throw new Error("Arg missing: '" + argName + "'");
  },

  //////////////////////////////////////////////////////////////////////////////
  // Cached queries
  //
  // We hand out a promise and immediately perform a cache lookup.  If the cache
  //  lookup succeed, we return that.  If the cache lookup fails, we schedule
  //  a throttled query and cache its results.

  search: function(phrase, relationship, sort, page) {
    var deferred = $Q.defer(), self = this;
    if (!page)
      page = 1;

    var cacheName = 's:' + relationship + ':' + page + ':' + sort + ':' +
                      phrase;
    this._redis.get(cacheName, function(err, result) {
      // - use the cached result if we got it and it's still valid
      if (result) {
        var respObj = JSON.parse(result);
        var validAsOf = new Date(self._pickoutArg(respObj, 'Timestamp'));
        var respAgeMS = Date.now() - validAsOf.valueOf();
        if (respAgeMS < MAX_DATA_AGE_MS) {
          deferred.resolve(respObj.Items);
          return;
        }
      }

      // - no (usable) cache, issue a query.
      var params = {
        SearchIndex: self._searchIndex,
        Keywords: phrase,
        ResponseGroup: self._searchResponseGroups,
        RelationshipType: relationship,
        ItemPage: page,
        Sort: sort,
      };
      self._queueSearch(cacheName, params, deferred);
    });

    return deferred.promise;
  },

  /**
   * Queue a search for throttled processing and caching the results.
   */
  _queueSearch: function(cacheName, params, deferred) {
    this._queryQueue.push(
      { type: 'search', cacheName: cacheName, params: params,
        deferred: deferred });
    if (this._activeTimeout === null)
      this._runNextQueued();
  },

  _runNextQueued: function() {
    var action = this._queryQueue.shift(), self = this;
    this._activeTimeout = setTimeout(function() {
      self._activeTimeout = null;
      if (self._queryQueue.length)
        self._runNextQueued();
    }, THROTTLE_MS);

    this._opHelper.execute('ItemSearch', action.params,
                           function(error, results) {
      if (error) {
        action.deferred.reject(error);
        return;
      }
      // - issue cache write
      self._redis.set(action.cacheName, JSON.stringify(results),
                      function(err, result) {
        if (err)
          console.error("cache write problem on: " + cacheName);
      });
      // - resolve contents
      action.deferred.resolve(results.Items);
    });
  },

  //////////////////////////////////////////////////////////////////////////////
  // Raw (un-cached) queries
  //
  // These are completely oblivious to the caching and throttling logic.

  rawSearch: function(params) {
    var deferred = $Q.defer();

    this._opHelper.execute('ItemSearch', params, function(error, results) {
      if (error) {
        deferred.reject(error);
      }
      else {
        deferred.resolve(results);
      }
    });

    return deferred.promise;
  },

  rawLookup: function(params) {
    var deferred = $Q.defer();

    this._opHelper.execute('ItemLookup', params, function(error, results) {
      if (error) {
        deferred.reject(error);
      }
      else {
        deferred.resolve(results);
      }
    });

    return deferred.promise;
  },

  //////////////////////////////////////////////////////////////////////////////
};

exports.doSearch = function(phrase) {
  var searcher = new Searcher();
  var params = {
    SearchIndex: 'MP3Downloads',
    Keywords: phrase,
    // Not so useful: BrowseNodes
    ResponseGroup: 'ItemAttributes,Images,RelatedItems',
    // == Relationship types:
    // - AuthorityTitle does not seem to work?
    // - DigitalMusicPrimaryArtist - returns the artist ASIN nicely
    //   (with ProductTypeName: 'DOWNLOADABLE_MUSIC_ARTIST')
    // - Tracks - returns the album ASIN nicely
    //   (with ProductTypeName: 'DOWNLOADABLE_MUSIC_ALBUM')
    RelationshipType: 'Tracks',
    // It looks like higher pages might work?  I got 11 to work...
    //ItemPage: 1,
  };
  console.log("Searching on", phrase);
  return when(searcher.rawSearch(params), function(results) {
    console.error("results:");
    console.error($util.inspect(results, false, 12));
  });
};

exports.doASINLookup = function(asins) {
  var searcher = new Searcher();
  var params = {
    ItemId: asins,
    ResponseGroup: 'ItemAttributes,Images,RelatedItems',
    // == Relationship types:
    // - AuthorityTitle does not seem to work here either
    // - DigitalMusicPrimaryArtist - does not seem to work
    // - Tracks - returns the album tracks well enough (ASIN/title/number)
    //   (ProductTypeName: 'DOWNLOADABLE_MUSIC_TRACK')
    RelationshipType: 'AuthorityTitle',
  };
  console.log("ASIN lookup(s) on", asins);
  return when(searcher.rawLookup(params), function(results) {
    console.error("results:");
    console.error($util.inspect(results, false, 12));
  });
};


}); // end define
