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

function Artist(name) {
  this.name = name;

  this.albums = [];
  this.albumsByASIN = {};


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
    return album;
  },
};

function Album(ASIN, artist, title, imageInfo) {
  this.ASIN = ASIN;
  this.artist = artist;
  this.title = title;
  this.imageInfo = imageInfo;
  this.tracks = [];
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
    while (idx >= this.tracks.length)
      this.tracks.push(null);
    this.tracks[idx] = track;
  }
};

function Track(album, artist, ASIN, num, title, secs, date) {
  this.album = album;
  this.artist = artist;
  this.ASIN = ASIN;
  this.num = num;
  this.title = title;
  this.secs = secs;
  this.date = date;
}
exports.Track = Track;
Track.prototype = {
};


function ArtistSet() {
  this.all = [];
  this.byName = {};
}
exports.ArtistSet = ArtistSet;
ArtistSet.prototype = {
  getOrCreateArtist: function(name) {
    if (this.byName.hasOwnProperty(name))
      return this.byName[name];
    var artist = this.byName[name] = new Artist(name);
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
};

}); // end define
