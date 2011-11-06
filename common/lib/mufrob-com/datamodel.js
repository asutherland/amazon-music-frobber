/**
 * Amazon specific data representation designed for the scouring process.
 **/

define(
  [
    'exports'
  ],
  function(
    exports
  ) {

function Artist(name, _set) {
  this.name = name;

  this.albums = [];
  this.albumsByASIN = {};

  this.__set = _set;

  this.__trackSpam = 0;
  this.__trackHam = 0;
}
exports.Artist = Artist;
Artist.prototype = {
  getOrCreateAlbum: function(ASIN, title, imageInfo) {
    if (this.albumsByASIN.hasOwnProperty(ASIN))
      return this.albumsByASIN[ASIN];
    var album = new Album(ASIN, this, title, imageInfo);
    this.albumsByASIN[ASIN] = album;
    this.albums.push(album);
    this.__set.__allAlbums.push(album);
    return album;
  },
};

function Album(ASIN, artist, title, imageInfo) {
  this.ASIN = ASIN;
  this.artist = artist;
  this.title = title;
  this.imageInfo = imageInfo;
  this.tracks = [];
  this.discs = [this.tracks];

  this.__knownTrackCount = null;

  /**
   * Track if we need an explicit lookup fixup pass because it appears that
   *  this must be a multi-disc album because we saw different tracks with
   *  the same track number.
   */
  this._needFixup = false;
}
exports.Album = Album;
Album.prototype = {
  hasTrack: function(trackNumber) {
    if (trackNumber > this.tracks.length)
      return false;
    return this.tracks[trackNumber - 1] !== null;
  },
  putTrack: function(track) {
    var idx = track.num - 1;
    var tracks = this.tracks;
    if (track.disc !== 1) {
      var discIdx = track.disc - 1;
      while (discIdx >= this.discs.length)
        this.discs.push([]);
      tracks = this.discs[discIdx];
    }
    while (idx >= tracks.length)
      tracks.push(null);
    // mark fixup required because this is a colliding track...
    if (tracks[idx] != null &&
        tracks[idx].ASIN !== track.ASIN) {
      if (!this._needFixup)
        this._needFixup = [];
      this._needFixup.push(tracks[idx]);
    }
    tracks[idx] = track;
  },

  __resetTracks: function() {
    this.tracks = [];
    this.discs = [this.tracks];
  },

  __isFixupNeeded: function() {
    if (this._needFixup ||
        // or if we have a non-matching track count but have at least one
        //  track.  (in other words, rule out albums that match without any
        //  tracks also matching.  at least for now.)
        (this.__knownTrackCount &&
         this.discs.length === 1 && this.tracks.length &&
         this.tracks.length !== this.__knownTrackCount))
      return true;
    return false;
  },
};

function Track(album, artist, ASIN, disc, num, title, secs, date,
               searchFound) {
  this.album = album;
  this.artist = artist;
  this.ASIN = ASIN;
  this.disc = disc;
  this.num = num;
  this.title = title;
  this.secs = secs;
  this.date = date;
  this.searchFound = searchFound;
}
exports.Track = Track;
Track.prototype = {
};


function ArtistSet() {
  this.all = [];
  this.byName = {};

  this.__allAlbums = [];
}
exports.ArtistSet = ArtistSet;
ArtistSet.prototype = {
  getOrCreateArtist: function(name) {
    if (this.byName.hasOwnProperty(name))
      return this.byName[name];
    var artist = this.byName[name] = new Artist(name, this);
    this.all.push(artist);
    return artist;
  },

  getSortedArtists: function() {
    var result = this.all.concat();
    result.sort(function(a, b) {
                  return a.name.localeCompare(b.name);
                });
    return result;
  },

  /**
   * Retrieve a list of albums that require an explicit album lookup
   */
  getAlbumsRequiringFixup: function() {
    var fixupAlbums = [], albums = this.__allAlbums;
    for (var i = 0; i < albums.length; i++) {
      if (albums[i].__isFixupNeeded())
        fixupAlbums.push(albums[i]);
    }
    return fixupAlbums;
  },
};

}); // end define
