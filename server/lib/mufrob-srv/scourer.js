/**
 * Performs the multiple queries required to fully generate a list of search
 *  matches and fill out the representations.
 **/

define(
  [
    'util',
    'q',
    './searcher',
    'mufrob-com/datamodel',
    'exports'
  ],
  function(
    $util,
    $Q,
    $searcher,
    $datamodel,
    exports
  ) {
const when = $Q.when;

const MAX_PAGES_TO_CONSUME = 50;

/**
 * Deal with the eccentricities of the Amazon search API to build our useful
 *  datamodel representation.  A lot of this has to do with rate-limiting
 *  queries, aggregating potentially orthogonal queries (especially given the
 *  rate-limiting), and paging through result sets.
 *
 * The set of information we want, given any query, is:
 * - Album associated with each track.
 * - Artist associated with each track (and thereby album).
 *
 * Our data gathering capabilities are:
 * - ItemSearch returns tracks, providing: ASIN, track title, images, date,
 *    artist name in string form without unique identifier.
 * - ItemSearch RelationshipType=DigitalMusicPrimaryArtist nets us the artist
 *    ASIN plus the Title which should be the same as what we already had.
 * - ItemSearch RelationshipType=Tracks nets us the album ASIN and title.
 * - ItemLookup RelationshipType=Tracks on the album ASIN nets us a list of all
 *    the tracks with ItemAttributes payload.  This most usefully nets us the
 *    track Title, TrackSequence, and the artist (sans ASIN) via Creator['#'].
 * - The official page limit is 10 pages, but we may be able to get more.
 *
 * Theoretical capabilities that should work according to the docs, but don't:
 * - RelationshipType=AuthorityTitle should in theory group albums together by
 *    artist.  This did not work for me for "Two Door Cinema Club" (which seems
 *    to lack an official artist page) nor "Pet Shop Boys" (who do very much
 *    have an artist page).
 *
 * Relevant domain notes:
 * - At least in the CD world, when faced with name collisions, it did not seem
 *    (as a user of the website) that the ASINs did not also collide.
 *
 * Therefore arbitrary choices:
 * - For now we do not care about artist ASINs because we don't trust that they
 *    are any more reliable than the name and the AuthorityTitle stuff appears
 *    to be useless.  We just directly key based on the artist name.
 *
 * Our scouring strategy accordingly is:
 * - Issue an ItemSearch for tracks, using RelationshipType=Tracks to get the
 *    album info.
 * - Keep doing that for pages until we run out of pages or we hit diminshing
 *    returns or we hit an internal hardcoded limit.
 *
 *
 * NEW NOTE, 2011/11/06, merge in with the above soon...
 *
 * Multi-disc albums are not being handled properly by our current strategy.  It
 *  appears we will need to observe the DOWNLOADABLE_MUSIC_ALBUM entry and
 *  follow it's 'Children' relationship of type 'Tracks' which appears to
 *  include all the entries, although we will need to page and infer by the
 *  track index renumbering happening.
 */
function Scourer() {
  this.searcher = new $searcher.Searcher();

  this.phrase = '';
  this.artists = null;
  this.highPage = 0;
}
exports.Scourer = Scourer;
Scourer.prototype = {
  scour: function(phrase) {
    this.phrase = phrase;
    this.artists = new $datamodel.ArtistSet();
    this.highPage = 1;

    return this._scourPage(this.highPage);
  },

  _scourPage: function(pageNum) {
    console.log("=== scouring page:", pageNum);
    var self = this;
    return when(this.searcher.search(this.phrase, $searcher.REL_TRACKS,
                                     $searcher.SORT_RELEVANCE, pageNum),
                function(resp) {
      console.log("  got page data:", pageNum);


      if (resp.hasOwnProperty("Item") && resp.Item) {
        var rawItems = resp.Item, artists = self.artists;
        for (var iItem = 0; iItem < rawItems.length; iItem++) {
          //console.error();
          //console.error("!!!!! track",$util.inspect(rawItems[iItem], false, 12));
          var rawItem = rawItems[iItem],
              attrs = rawItem.ItemAttributes,
              albumArtistName, albumArtist, albumASIN, albumTitle, albumImage,
              album;
          // -- Album Processing
          if (attrs.ProductTypeName === 'DOWNLOADABLE_MUSIC_ALBUM') {
            albumArtistName = attrs.Creator['#'];
            albumASIN = rawItem.ASIN;
            albumTitle = attrs.Title;

            albumImage = {
              url: rawItem.LargeImage.URL,
              width: parseInt(rawItem.LargeImage.Width['#']),
              height: parseInt(rawItem.LargeImage.Height['#']),
            };

            albumArtist = artists.getOrCreateArtist(albumArtistName);
            album = albumArtist.getOrCreateAlbum(albumASIN, albumTitle,
                                                 albumImage);

            album.__knownTrackCount =
              parseInt(rawItem.RelatedItems.RelatedItemCount);

            // but no more processing...
            continue;
          }
          // -- Ignore non-albums, non-tracks
          else if (attrs.ProductTypeName !== 'DOWNLOADABLE_MUSIC_TRACK') {
            //console.log("skipping", attrs);
            continue;
          }

          var relItem = rawItem.RelatedItems.RelatedItem.Item,
              relAttrs = relItem.ItemAttributes;

          // -- pick useful fields out
          var artistName = attrs.Creator['#'];

          albumASIN = relItem.ASIN;
          albumTitle = relAttrs.Title;
          // (could be Various Artists)
          albumArtistName = relAttrs.Creator['#'];

          // skip tracks missing images...
          if (!rawItem.LargeImage)
            continue;
          // we are assuming this holds the same for all tracks
          albumImage = {
            url: rawItem.LargeImage.URL,
            width: parseInt(rawItem.LargeImage.Width['#']),
            height: parseInt(rawItem.LargeImage.Height['#']),
          };

          var trackASIN = rawItem.ASIN;
          var trackTitle = attrs.Title;
          var trackNum = parseInt(attrs.TrackSequence);
          var trackLength = parseInt(attrs.RunningTime['#']);
          var trackDate = new Date(attrs.ReleaseDate);

          // -- populate datamodel
          albumArtist = artists.getOrCreateArtist(albumArtistName);
          var trackArtist = artists.getOrCreateArtist(artistName);

          console.log("Seeing", albumArtistName, "|", artistName, "|",
                      trackTitle);

          album = albumArtist.getOrCreateAlbum(albumASIN, albumTitle,
                                               albumImage);
          // assume tracks are all on disc 1; we'll do a fixup pass if this
          //  turns out to be wrong.
          var discNum = 1;
          var track = new $datamodel.Track(album, trackArtist, trackASIN,
                                           discNum,
                                           trackNum, trackTitle, trackLength,
                                           trackDate, true);
          album.putTrack(track);
        }

        // -- get more pages?
        var totalPages = parseInt(resp.TotalPages);
        if (pageNum < totalPages &&
            pageNum < MAX_PAGES_TO_CONSUME) {
          console.log("pageNum", pageNum, "totalPages", totalPages);
          return self._scourPage(pageNum + 1);
        }
      }

      // -- perform any fixup required
      var albumsRequiringFixup = self.artists.getAlbumsRequiringFixup();
      return self._fixupAlbums(albumsRequiringFixup);
    });
  },

  _fixupAlbum: function(album, item) {

console.log("fixup album:", album.title, album.tracks.length);
    // - build a map from ASIN to track
    var tracksByASIN = {}, iTrack, track;
    for (iTrack = 0; iTrack < album.tracks.length; iTrack++) {
      track = album.tracks[iTrack];
      if (!track)
        continue;
      tracksByASIN[track.ASIN] = track;
    }
    for (iTrack = 0; iTrack < album._needFixup; iTrack++) {
      track = album._needFixup[iTrack];
      if (!track)
        continue;
      tracksByASIN[track.ASIN] = track;
    }

    // - nuke the current track setup
    album.__resetTracks();

    // - process the received explicit track ordering
    var discNum = 1, lastTrackNum = 0,
        rawTracks = item.RelatedItems.RelatedItem;

    // some albums (ex: "Saturdays = Youth [+Digital Booklet]") do not have a
    //  sane ordering by default.  Detect them by observing the first index is
    //  not 1.
    var suspectOrdering = rawTracks[0].Item.ItemAttributes.TrackSequence !== '1';

    for (iTrack = 0; iTrack < rawTracks.length; iTrack++) {
      var rawTrack = rawTracks[iTrack].Item;
      var trackNum = parseInt(rawTrack.ItemAttributes.TrackSequence);
      if (trackNum < lastTrackNum && !suspectOrdering)
        discNum++;

      if (!tracksByASIN.hasOwnProperty(rawTrack.ASIN)) {
        // it's possible for us to miss out on tracks, so create them on demand
        console.log("  Unknown track", rawTrack.ASIN,
                     rawTrack.ItemAttributes.TrackSequence,
                     rawTrack.ItemAttributes.Title);
        var attrs = rawTrack.ItemAttributes;
        var trackASIN = rawTrack.ASIN;
        var trackTitle = attrs.Title;
        var trackLength = parseInt(attrs.RunningTime['#']);
        var trackDate = new Date(attrs.ReleaseDate);

        var artistName = attrs.Creator['#'];
        var trackArtist = this.artists.getOrCreateArtist(artistName);

        track = new $datamodel.Track(album, trackArtist, trackASIN,
                                     discNum,
                                     trackNum, trackTitle, trackLength,
                                     trackDate, false);
      }
      else {
        track = tracksByASIN[rawTrack.ASIN];
      }

      // - fixup the disc number and place the track
      track.disc = discNum;
      album.putTrack(track);

      lastTrackNum = trackNum;
    }
  },

  _fixupAlbums: function _fixupAlbums(albums) {
    var curBunch, self = this;
    function gotAlbumData(items) {
      if (items) {
        for (var i = 0; i < curBunch.length; i++) {
          self._fixupAlbum(curBunch[i], items[i]);
        }
      }
      if (albums.length) {
        curBunch = albums.splice(0, 10);
        var asins = curBunch.map(function(a) { return a.ASIN; });
        console.log("== fixing up albums");
        return when(
          self.searcher.multipageLookup(asins, 'Tracks'),
          gotAlbumData);
      }
      return self.artists;
    }

    return gotAlbumData(null);
  },
};

exports.cmdScour = function(phrase) {
  var scourer = new Scourer();
  return when(scourer.scour(phrase), function(artistSet) {
    console.log();
    var artists = artistSet.getSortedArtists();
    for (var iArtist = 0; iArtist < artists.length; iArtist++) {
      var artist = artists[iArtist];

      console.log();
      console.log();
      console.log("== Artist:", artist.name);

      for (var iAlbum = 0; iAlbum < artist.albums.length; iAlbum++) {
        var album = artist.albums[iAlbum];
        console.log();
        console.log("  Album:", album.title);

        for (var iDisc = 0; iDisc < album.discs.length; iDisc++) {
          var tracks = album.discs[iDisc];
          for (var iTrack = 0; iTrack < tracks.length; iTrack++) {
            var track = tracks[iTrack];
            if (track) {
              var otherArtistBit = "";
              if (track.artist !== artist) {
                otherArtistBit = "(" + track.artist.name + ")";
              }
              console.log("   ", track.num, "-", track.title, otherArtistBit);
            }
          }
        }
      }
    }
  });
};

}); // end define
