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
      var rawTracks = resp.Item, artists = self.artists;
      for (var iTrack = 0; iTrack < rawTracks.length; iTrack++) {
        //console.error();
        //console.error("!!!!! track",$util.inspect(rawTracks[iTrack], false, 12));
        var rawTrack = rawTracks[iTrack],
            attrs = rawTrack.ItemAttributes;
        // ignore things which are not tracks; for example, the artist can
        //  show up in here...
        if (attrs.ProductTypeName !== 'DOWNLOADABLE_MUSIC_TRACK') {
          //console.log("skipping", attrs);
          continue;
        }

        var relItem = rawTrack.RelatedItems.RelatedItem.Item,
            relAttrs = relItem.ItemAttributes;

        // -- pick useful fields out
        var artistName = attrs.Creator['#'];

        var albumASIN = relItem.ASIN;
        var albumTitle = relAttrs.Title;
        // (could be Various Artists)
        var albumArtistName = relAttrs.Creator['#'];
        // we are assuming this holds the same for all tracks
        var albumImage = {
          url: rawTrack.LargeImage.URL,
          width: parseInt(rawTrack.LargeImage.Width['#']),
          height: parseInt(rawTrack.LargeImage.Height['#']),
        };

        var trackASIN = rawTrack.ASIN;
        var trackTitle = attrs.Title;
        var trackNum = parseInt(attrs.TrackSequence);
        var trackLength = parseInt(attrs.RunningTime['#']);
        var trackDate = new Date(attrs.ReleaseDate);

        // -- populate datamodel
        var albumArtist = artists.getOrCreateArtist(albumArtistName);
        var trackArtist = artists.getOrCreateArtist(artistName);

        console.log("Seeing", albumArtistName, "|", artistName, "|", trackTitle);

        var album = albumArtist.getOrCreateAlbum(albumASIN, albumTitle,
                                                 albumImage);
        var track = new $datamodel.Track(album, trackArtist, trackASIN,
                                         trackNum, trackTitle, trackLength,
                                         trackDate);
        album.putTrack(track);
      }

      // -- get more pages?
      var totalPages = parseInt(resp.TotalPages);
      if (pageNum < totalPages &&
          pageNum < MAX_PAGES_TO_CONSUME) {
        console.log("pageNum", pageNum, "totalPages", totalPages);
        return self._scourPage(pageNum + 1);
      }
      return artists;
    });
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

        for (var iTrack = 0; iTrack < album.tracks.length; iTrack++) {
          var track = album.tracks[iTrack];
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
  });
};

}); // end define
