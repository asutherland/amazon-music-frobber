var DEATH_PRONE = false;
var SUPER_DEBUG = false;

var ErrorTrapper = {
  _trappedErrors: null,
  _handlerCallback: null,
  /**
   * Express interest in errors.
   */
  trapErrors: function() {
    this._trappedErrors = [];
  },
  callbackOnError: function(handler) {
    this._handlerCallback = handler;
    this._trappedErrors = [];
  },
  yoAnError: function(err, moduleName) {
    if (this._trappedErrors == null || SUPER_DEBUG) {
      console.error("==== REQUIREJS ERR ====", moduleName);
      console.error(err.message);
      console.error(err.stack);
      if (DEATH_PRONE) {
        console.error("PERFORMING PROCESS EXIT");
        process.exit(1);
      }
    }
    if (this._handlerCallback)
      this._handlerCallback(err, moduleName);
    else if (this._trappedErrors)
      this._trappedErrors.push(err);
  },
  gobbleAndStopTrappingErrors: function() {
    this._handlerCallback = null;
    var errs = this._trappedErrors;
    this._trappedErrors = null;
    return errs;
  },
};

require.onError = function(err) {
  //console.error("(Exception)");
  //console.error("RJS EX STACK", err.message, err.stack);

  var useErr = err;
  if (err.originalError)
    useErr = err.originalError;
  ErrorTrapper.yoAnError(useErr, err.moduleName);
};

require(
  {
    baseUrl: "../../",
    packages: [
    ],
    paths: {
      'mufrob-srv': "server/lib/mufrob-srv",
      'mufrob-com': "common/lib/mufrob-com",
    },
  },
  [
    "nomnom",
    "q",
    "require"
  ],
  function(
    $nomnom,
    $Q,
    require
  ) {
var when = $Q.when;

process.on("uncaughtException",
  function(err) {
    console.error("==== UNCAUGHT ====");
    console.error(err.message);
    console.error(err);
    console.error(err.stack);
    if (DEATH_PRONE)
      process.exit(1);
  });

var DEFAULT_WATCHDOG_TIMEOUT = 3 * 60 * 1000;
function deathClock(timeout, nonfatal) {
  if (timeout === undefined)
    timeout = DEFAULT_WATCHDOG_TIMEOUT;
  if (!nonfatal)
    DEATH_PRONE = true;
  setTimeout(function() {
    console.error("WATCHDOG KILLIN");
    process.exit(10);
  }, timeout);
}

var parser = $nomnom.globalOpts({
  superDebug: {
    string: "--super-debug",
    default: false,
    help: "Should we crank the logging up so that it emits to the console?",
  },
});

function applyGlobalOptions(options) {
  if (options.superDebug) {
    console.error("SUPER DEBUG");
    SUPER_DEBUG = true;
  }
};

parser.command('scour')
  .help("Run a smart scour and dump the results.")
  .opts({
    searchString: {
      position: 1,
      default: null,
    },
  })
  .callback(function(options) {
    console.log("(in search command)");
    applyGlobalOptions(options);
    require(['mufrob-srv/scourer'], function($scourer) {
      when($scourer.cmdScour(options.searchString), function() {
        process.exit(0);
      }, function(err) {
        if (err instanceof Error)
          ErrorTrapper.yoAnError(err);
        console.error("ERR:", err);
        process.exit(1);
      });
    });
  });



parser.command('search')
  .help("Run a command-line search and dump the results.")
  .opts({
    searchString: {
      position: 1,
      default: null,
    },
  })
  .callback(function(options) {
    console.log("(in search command)");
    applyGlobalOptions(options);
    require(['mufrob-srv/searcher'], function($searcher) {
      when($searcher.doSearch(options.searchString), function() {
        process.exit(0);
      }, function(err) {
        console.error("ERR:", err);
        process.exit(1);
      });
    });
  });

parser.command('asin')
  .help("Run a command-line ASIN search and dump the results.")
  .opts({
    searchString: {
      position: 1,
      default: null,
    },
    relationshipType: {
      string: "--reltype",
      default: 'AuthorityTitle',
      help: "RelationshipType, examples include: AuthorityTitle, " +
        "DigitalMusicPrimaryArtist, Tracks",
    },
  })
  .callback(function(options) {
    console.log("(in asin command)");
    applyGlobalOptions(options);
    require(['mufrob-srv/searcher'], function($searcher) {
      when($searcher.doASINLookup(options.searchString,
                                  options.relationshipType), function() {
        process.exit(0);
      }, function(err) {
        console.error("ERR:", err);
        process.exit(1);
      });
    });
  });


// We need to do our own argv slicing to compensate for RequireJS' r.js
parser.parseArgs(process.argv.slice(3));

}); // end require
