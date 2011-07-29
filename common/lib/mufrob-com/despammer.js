/**
 * Streaming or batch results analysis to try and filter out all the
 *  cover/karaoke crap that clogs up amazon mp3 searches.
 **/

define(
  [
    'exports'
  ],
  function(
    exports
  ) {

/**
 * Process tracks for spamminess; the goal is to eliminate karaoke/covers/etc.
 *  without eliminating remixes of the artist or by the artist.  Remixes by
 *  the artist is the tricker thing since it won't be attributed to the artist
 *  directly and instead must be inferred.
 *
 * Jerky artist heuristics:
 * - "*made famous by*"
 * - "*tribute*" (covers "tribute band" too)
 *
 * Jerky track title heuristics:
 * - "*Made Famous By*"
 * - "*Tribute To*"
 * - "*Ringtone*"
 * - "*Remake*"
 * Suspect track title heuristics:
 * - "*Karaoke*"
 *
 * Jerky album title heuristics:
 * - "*in the style of*"
 */
function Despammer() {
}
Despammer.prototype = {
  /**
   * Process a track, performing spamminess annotations.  Return a float
   *  indicating probability of usefulness of the track so that the scourer
   *  can know when it has reached the point of diminishing returns.
   */
  processTrack: function(track) {
  },
};

}); // end define

