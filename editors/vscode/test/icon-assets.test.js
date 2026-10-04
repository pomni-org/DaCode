'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ASSETS = path.join(__dirname, '..', 'assets');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPng(fileName) {
  const data = fs.readFileSync(path.join(ASSETS, fileName));
  assert.deepEqual(data.subarray(0, 8), PNG_SIGNATURE, `${fileName} must be a PNG`);

  let offset = 8;
  let width;
  let height;
  let seenIend = false;
  const idat = [];

  while (offset < data.length) {
    assert.ok(offset + 12 <= data.length, `${fileName} contains a truncated PNG chunk`);
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    assert.ok(end <= data.length, `${fileName} contains a truncated ${type} chunk`);

    if (type === 'IHDR') {
      assert.equal(length, 13, `${fileName} has an invalid IHDR chunk`);
      width = data.readUInt32BE(offset + 8);
      height = data.readUInt32BE(offset + 12);
    } else if (type === 'IDAT') {
      idat.push(data.subarray(offset + 8, offset + 8 + length));
    } else if (type === 'IEND') {
      assert.equal(length, 0, `${fileName} has an invalid IEND chunk`);
      assert.equal(end, data.length, `${fileName} has data after IEND`);
      seenIend = true;
    }

    offset = end;
  }

  assert.ok(seenIend, `${fileName} must contain a complete IEND chunk`);
  assert.ok(idat.length > 0, `${fileName} must contain image data`);
  assert.doesNotThrow(
    () => zlib.inflateSync(Buffer.concat(idat)),
    `${fileName} must contain a complete decodable image stream`,
  );
  return {width, height};
}

test('Marketplace icon is a complete 256x256 PNG', () => {
  assert.deepEqual(readPng('dacode-marketplace.png'), {width: 256, height: 256});
});

test('DaCode file icon is a complete 32x32 PNG', () => {
  assert.deepEqual(readPng('dacode-file.png'), {width: 32, height: 32});
});
