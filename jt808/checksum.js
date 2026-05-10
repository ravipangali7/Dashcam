/** XOR check code from first byte (message id high) through last body byte. */

function checksum(buf) {
  let c = 0;
  for (let i = 0; i < buf.length; i++) c ^= buf[i];
  return c & 0xff;
}

module.exports = { checksum };
