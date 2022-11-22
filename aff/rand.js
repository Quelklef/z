// Modified from https://stackoverflow.com/a/19301306/4608364

exports.mkRand = function() {

  var m_w = 123456789;
  var m_z = 987654321;
  var mask = 0xffffffff;

  // Takes any integer
  function seed(i) {
    m_w = (123456789 + i) & mask;
    m_z = (987654321 - i) & mask;
  }

  // Returns number between 0 (inclusive) and 1.0 (exclusive)
  function random() {
    m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & mask;
    m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & mask;
    var result = ((m_z << 16) + (m_w & 65535)) >>> 0;
    result = result / 4294967296;
    return result;
  }

  return random;

}
