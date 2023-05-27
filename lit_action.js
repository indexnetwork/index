/**
 *
 * NAME: main
 *
 */

"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name4 in all)
      __defProp(target, name4, { get: all[name4], enumerable: true });
  };
  var __copyProps = (to, from5, except, desc) => {
    if (from5 && typeof from5 === "object" || typeof from5 === "function") {
      for (let key of __getOwnPropNames(from5))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from5[key], enumerable: !(desc = __getOwnPropDesc(from5, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
      mod
  ));

  // node_modules/fast-json-stable-stringify/index.js
  var require_fast_json_stable_stringify = __commonJS({
    "node_modules/fast-json-stable-stringify/index.js"(exports, module) {
      "use strict";
      module.exports = function(data, opts) {
        if (!opts)
          opts = {};
        if (typeof opts === "function")
          opts = { cmp: opts };
        var cycles = typeof opts.cycles === "boolean" ? opts.cycles : false;
        var cmp = opts.cmp && function(f) {
          return function(node) {
            return function(a, b) {
              var aobj = { key: a, value: node[a] };
              var bobj = { key: b, value: node[b] };
              return f(aobj, bobj);
            };
          };
        }(opts.cmp);
        var seen = [];
        return function stringify2(node) {
          if (node && node.toJSON && typeof node.toJSON === "function") {
            node = node.toJSON();
          }
          if (node === void 0)
            return;
          if (typeof node == "number")
            return isFinite(node) ? "" + node : "null";
          if (typeof node !== "object")
            return JSON.stringify(node);
          var i, out;
          if (Array.isArray(node)) {
            out = "[";
            for (i = 0; i < node.length; i++) {
              if (i)
                out += ",";
              out += stringify2(node[i]) || "null";
            }
            return out + "]";
          }
          if (node === null)
            return "null";
          if (seen.indexOf(node) !== -1) {
            if (cycles)
              return JSON.stringify("__cycle__");
            throw new TypeError("Converting circular structure to JSON");
          }
          var seenIndex = seen.push(node) - 1;
          var keys = Object.keys(node).sort(cmp && cmp(node));
          out = "";
          for (i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = stringify2(node[key]);
            if (!value)
              continue;
            if (out)
              out += ",";
            out += JSON.stringify(key) + ":" + value;
          }
          seen.splice(seenIndex, 1);
          return "{" + out + "}";
        }(data);
      };
    }
  });

  // node_modules/elliptic/package.json
  var require_package = __commonJS({
    "node_modules/elliptic/package.json"(exports, module) {
      module.exports = {
        name: "elliptic",
        version: "6.5.4",
        description: "EC cryptography",
        main: "lib/elliptic.js",
        files: [
          "lib"
        ],
        scripts: {
          lint: "eslint lib test",
          "lint:fix": "npm run lint -- --fix",
          unit: "istanbul test _mocha --reporter=spec test/index.js",
          test: "npm run lint && npm run unit",
          version: "grunt dist && git add dist/"
        },
        repository: {
          type: "git",
          url: "git@github.com:indutny/elliptic"
        },
        keywords: [
          "EC",
          "Elliptic",
          "curve",
          "Cryptography"
        ],
        author: "Fedor Indutny <fedor@indutny.com>",
        license: "MIT",
        bugs: {
          url: "https://github.com/indutny/elliptic/issues"
        },
        homepage: "https://github.com/indutny/elliptic",
        devDependencies: {
          brfs: "^2.0.2",
          coveralls: "^3.1.0",
          eslint: "^7.6.0",
          grunt: "^1.2.1",
          "grunt-browserify": "^5.3.0",
          "grunt-cli": "^1.3.2",
          "grunt-contrib-connect": "^3.0.0",
          "grunt-contrib-copy": "^1.0.0",
          "grunt-contrib-uglify": "^5.0.0",
          "grunt-mocha-istanbul": "^5.0.2",
          "grunt-saucelabs": "^9.0.1",
          istanbul: "^0.4.5",
          mocha: "^8.0.1"
        },
        dependencies: {
          "bn.js": "^4.11.9",
          brorand: "^1.1.0",
          "hash.js": "^1.0.0",
          "hmac-drbg": "^1.0.1",
          inherits: "^2.0.4",
          "minimalistic-assert": "^1.0.1",
          "minimalistic-crypto-utils": "^1.0.1"
        }
      };
    }
  });

  // (disabled):node_modules/buffer/index.js
  var require_buffer = __commonJS({
    "(disabled):node_modules/buffer/index.js"() {
    }
  });

  // node_modules/elliptic/node_modules/bn.js/lib/bn.js
  var require_bn = __commonJS({
    "node_modules/elliptic/node_modules/bn.js/lib/bn.js"(exports, module) {
      (function(module2, exports2) {
        "use strict";
        function assert2(val, msg) {
          if (!val)
            throw new Error(msg || "Assertion failed");
        }
        function inherits(ctor, superCtor) {
          ctor.super_ = superCtor;
          var TempCtor = function() {
          };
          TempCtor.prototype = superCtor.prototype;
          ctor.prototype = new TempCtor();
          ctor.prototype.constructor = ctor;
        }
        function BN(number3, base4, endian) {
          if (BN.isBN(number3)) {
            return number3;
          }
          this.negative = 0;
          this.words = null;
          this.length = 0;
          this.red = null;
          if (number3 !== null) {
            if (base4 === "le" || base4 === "be") {
              endian = base4;
              base4 = 10;
            }
            this._init(number3 || 0, base4 || 10, endian || "be");
          }
        }
        if (typeof module2 === "object") {
          module2.exports = BN;
        } else {
          exports2.BN = BN;
        }
        BN.BN = BN;
        BN.wordSize = 26;
        var Buffer2;
        try {
          if (typeof window !== "undefined" && typeof window.Buffer !== "undefined") {
            Buffer2 = window.Buffer;
          } else {
            Buffer2 = require_buffer().Buffer;
          }
        } catch (e) {
        }
        BN.isBN = function isBN(num) {
          if (num instanceof BN) {
            return true;
          }
          return num !== null && typeof num === "object" && num.constructor.wordSize === BN.wordSize && Array.isArray(num.words);
        };
        BN.max = function max(left, right) {
          if (left.cmp(right) > 0)
            return left;
          return right;
        };
        BN.min = function min(left, right) {
          if (left.cmp(right) < 0)
            return left;
          return right;
        };
        BN.prototype._init = function init(number3, base4, endian) {
          if (typeof number3 === "number") {
            return this._initNumber(number3, base4, endian);
          }
          if (typeof number3 === "object") {
            return this._initArray(number3, base4, endian);
          }
          if (base4 === "hex") {
            base4 = 16;
          }
          assert2(base4 === (base4 | 0) && base4 >= 2 && base4 <= 36);
          number3 = number3.toString().replace(/\s+/g, "");
          var start = 0;
          if (number3[0] === "-") {
            start++;
            this.negative = 1;
          }
          if (start < number3.length) {
            if (base4 === 16) {
              this._parseHex(number3, start, endian);
            } else {
              this._parseBase(number3, base4, start);
              if (endian === "le") {
                this._initArray(this.toArray(), base4, endian);
              }
            }
          }
        };
        BN.prototype._initNumber = function _initNumber(number3, base4, endian) {
          if (number3 < 0) {
            this.negative = 1;
            number3 = -number3;
          }
          if (number3 < 67108864) {
            this.words = [number3 & 67108863];
            this.length = 1;
          } else if (number3 < 4503599627370496) {
            this.words = [
              number3 & 67108863,
              number3 / 67108864 & 67108863
            ];
            this.length = 2;
          } else {
            assert2(number3 < 9007199254740992);
            this.words = [
              number3 & 67108863,
              number3 / 67108864 & 67108863,
              1
            ];
            this.length = 3;
          }
          if (endian !== "le")
            return;
          this._initArray(this.toArray(), base4, endian);
        };
        BN.prototype._initArray = function _initArray(number3, base4, endian) {
          assert2(typeof number3.length === "number");
          if (number3.length <= 0) {
            this.words = [0];
            this.length = 1;
            return this;
          }
          this.length = Math.ceil(number3.length / 3);
          this.words = new Array(this.length);
          for (var i = 0; i < this.length; i++) {
            this.words[i] = 0;
          }
          var j, w;
          var off = 0;
          if (endian === "be") {
            for (i = number3.length - 1, j = 0; i >= 0; i -= 3) {
              w = number3[i] | number3[i - 1] << 8 | number3[i - 2] << 16;
              this.words[j] |= w << off & 67108863;
              this.words[j + 1] = w >>> 26 - off & 67108863;
              off += 24;
              if (off >= 26) {
                off -= 26;
                j++;
              }
            }
          } else if (endian === "le") {
            for (i = 0, j = 0; i < number3.length; i += 3) {
              w = number3[i] | number3[i + 1] << 8 | number3[i + 2] << 16;
              this.words[j] |= w << off & 67108863;
              this.words[j + 1] = w >>> 26 - off & 67108863;
              off += 24;
              if (off >= 26) {
                off -= 26;
                j++;
              }
            }
          }
          return this.strip();
        };
        function parseHex4Bits(string4, index) {
          var c = string4.charCodeAt(index);
          if (c >= 65 && c <= 70) {
            return c - 55;
          } else if (c >= 97 && c <= 102) {
            return c - 87;
          } else {
            return c - 48 & 15;
          }
        }
        function parseHexByte(string4, lowerBound, index) {
          var r = parseHex4Bits(string4, index);
          if (index - 1 >= lowerBound) {
            r |= parseHex4Bits(string4, index - 1) << 4;
          }
          return r;
        }
        BN.prototype._parseHex = function _parseHex(number3, start, endian) {
          this.length = Math.ceil((number3.length - start) / 6);
          this.words = new Array(this.length);
          for (var i = 0; i < this.length; i++) {
            this.words[i] = 0;
          }
          var off = 0;
          var j = 0;
          var w;
          if (endian === "be") {
            for (i = number3.length - 1; i >= start; i -= 2) {
              w = parseHexByte(number3, start, i) << off;
              this.words[j] |= w & 67108863;
              if (off >= 18) {
                off -= 18;
                j += 1;
                this.words[j] |= w >>> 26;
              } else {
                off += 8;
              }
            }
          } else {
            var parseLength = number3.length - start;
            for (i = parseLength % 2 === 0 ? start + 1 : start; i < number3.length; i += 2) {
              w = parseHexByte(number3, start, i) << off;
              this.words[j] |= w & 67108863;
              if (off >= 18) {
                off -= 18;
                j += 1;
                this.words[j] |= w >>> 26;
              } else {
                off += 8;
              }
            }
          }
          this.strip();
        };
        function parseBase(str, start, end, mul) {
          var r = 0;
          var len = Math.min(str.length, end);
          for (var i = start; i < len; i++) {
            var c = str.charCodeAt(i) - 48;
            r *= mul;
            if (c >= 49) {
              r += c - 49 + 10;
            } else if (c >= 17) {
              r += c - 17 + 10;
            } else {
              r += c;
            }
          }
          return r;
        }
        BN.prototype._parseBase = function _parseBase(number3, base4, start) {
          this.words = [0];
          this.length = 1;
          for (var limbLen = 0, limbPow = 1; limbPow <= 67108863; limbPow *= base4) {
            limbLen++;
          }
          limbLen--;
          limbPow = limbPow / base4 | 0;
          var total = number3.length - start;
          var mod = total % limbLen;
          var end = Math.min(total, total - mod) + start;
          var word = 0;
          for (var i = start; i < end; i += limbLen) {
            word = parseBase(number3, i, i + limbLen, base4);
            this.imuln(limbPow);
            if (this.words[0] + word < 67108864) {
              this.words[0] += word;
            } else {
              this._iaddn(word);
            }
          }
          if (mod !== 0) {
            var pow = 1;
            word = parseBase(number3, i, number3.length, base4);
            for (i = 0; i < mod; i++) {
              pow *= base4;
            }
            this.imuln(pow);
            if (this.words[0] + word < 67108864) {
              this.words[0] += word;
            } else {
              this._iaddn(word);
            }
          }
          this.strip();
        };
        BN.prototype.copy = function copy(dest) {
          dest.words = new Array(this.length);
          for (var i = 0; i < this.length; i++) {
            dest.words[i] = this.words[i];
          }
          dest.length = this.length;
          dest.negative = this.negative;
          dest.red = this.red;
        };
        BN.prototype.clone = function clone2() {
          var r = new BN(null);
          this.copy(r);
          return r;
        };
        BN.prototype._expand = function _expand(size) {
          while (this.length < size) {
            this.words[this.length++] = 0;
          }
          return this;
        };
        BN.prototype.strip = function strip() {
          while (this.length > 1 && this.words[this.length - 1] === 0) {
            this.length--;
          }
          return this._normSign();
        };
        BN.prototype._normSign = function _normSign() {
          if (this.length === 1 && this.words[0] === 0) {
            this.negative = 0;
          }
          return this;
        };
        BN.prototype.inspect = function inspect() {
          return (this.red ? "<BN-R: " : "<BN: ") + this.toString(16) + ">";
        };
        var zeros = [
          "",
          "0",
          "00",
          "000",
          "0000",
          "00000",
          "000000",
          "0000000",
          "00000000",
          "000000000",
          "0000000000",
          "00000000000",
          "000000000000",
          "0000000000000",
          "00000000000000",
          "000000000000000",
          "0000000000000000",
          "00000000000000000",
          "000000000000000000",
          "0000000000000000000",
          "00000000000000000000",
          "000000000000000000000",
          "0000000000000000000000",
          "00000000000000000000000",
          "000000000000000000000000",
          "0000000000000000000000000"
        ];
        var groupSizes = [
          0,
          0,
          25,
          16,
          12,
          11,
          10,
          9,
          8,
          8,
          7,
          7,
          7,
          7,
          6,
          6,
          6,
          6,
          6,
          6,
          6,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5,
          5
        ];
        var groupBases = [
          0,
          0,
          33554432,
          43046721,
          16777216,
          48828125,
          60466176,
          40353607,
          16777216,
          43046721,
          1e7,
          19487171,
          35831808,
          62748517,
          7529536,
          11390625,
          16777216,
          24137569,
          34012224,
          47045881,
          64e6,
          4084101,
          5153632,
          6436343,
          7962624,
          9765625,
          11881376,
          14348907,
          17210368,
          20511149,
          243e5,
          28629151,
          33554432,
          39135393,
          45435424,
          52521875,
          60466176
        ];
        BN.prototype.toString = function toString7(base4, padding) {
          base4 = base4 || 10;
          padding = padding | 0 || 1;
          var out;
          if (base4 === 16 || base4 === "hex") {
            out = "";
            var off = 0;
            var carry = 0;
            for (var i = 0; i < this.length; i++) {
              var w = this.words[i];
              var word = ((w << off | carry) & 16777215).toString(16);
              carry = w >>> 24 - off & 16777215;
              if (carry !== 0 || i !== this.length - 1) {
                out = zeros[6 - word.length] + word + out;
              } else {
                out = word + out;
              }
              off += 2;
              if (off >= 26) {
                off -= 26;
                i--;
              }
            }
            if (carry !== 0) {
              out = carry.toString(16) + out;
            }
            while (out.length % padding !== 0) {
              out = "0" + out;
            }
            if (this.negative !== 0) {
              out = "-" + out;
            }
            return out;
          }
          if (base4 === (base4 | 0) && base4 >= 2 && base4 <= 36) {
            var groupSize = groupSizes[base4];
            var groupBase = groupBases[base4];
            out = "";
            var c = this.clone();
            c.negative = 0;
            while (!c.isZero()) {
              var r = c.modn(groupBase).toString(base4);
              c = c.idivn(groupBase);
              if (!c.isZero()) {
                out = zeros[groupSize - r.length] + r + out;
              } else {
                out = r + out;
              }
            }
            if (this.isZero()) {
              out = "0" + out;
            }
            while (out.length % padding !== 0) {
              out = "0" + out;
            }
            if (this.negative !== 0) {
              out = "-" + out;
            }
            return out;
          }
          assert2(false, "Base should be between 2 and 36");
        };
        BN.prototype.toNumber = function toNumber() {
          var ret = this.words[0];
          if (this.length === 2) {
            ret += this.words[1] * 67108864;
          } else if (this.length === 3 && this.words[2] === 1) {
            ret += 4503599627370496 + this.words[1] * 67108864;
          } else if (this.length > 2) {
            assert2(false, "Number can only safely store up to 53 bits");
          }
          return this.negative !== 0 ? -ret : ret;
        };
        BN.prototype.toJSON = function toJSON() {
          return this.toString(16);
        };
        BN.prototype.toBuffer = function toBuffer(endian, length4) {
          assert2(typeof Buffer2 !== "undefined");
          return this.toArrayLike(Buffer2, endian, length4);
        };
        BN.prototype.toArray = function toArray2(endian, length4) {
          return this.toArrayLike(Array, endian, length4);
        };
        BN.prototype.toArrayLike = function toArrayLike(ArrayType, endian, length4) {
          var byteLength = this.byteLength();
          var reqLength = length4 || Math.max(1, byteLength);
          assert2(byteLength <= reqLength, "byte array longer than desired length");
          assert2(reqLength > 0, "Requested array length <= 0");
          this.strip();
          var littleEndian = endian === "le";
          var res = new ArrayType(reqLength);
          var b, i;
          var q = this.clone();
          if (!littleEndian) {
            for (i = 0; i < reqLength - byteLength; i++) {
              res[i] = 0;
            }
            for (i = 0; !q.isZero(); i++) {
              b = q.andln(255);
              q.iushrn(8);
              res[reqLength - i - 1] = b;
            }
          } else {
            for (i = 0; !q.isZero(); i++) {
              b = q.andln(255);
              q.iushrn(8);
              res[i] = b;
            }
            for (; i < reqLength; i++) {
              res[i] = 0;
            }
          }
          return res;
        };
        if (Math.clz32) {
          BN.prototype._countBits = function _countBits(w) {
            return 32 - Math.clz32(w);
          };
        } else {
          BN.prototype._countBits = function _countBits(w) {
            var t = w;
            var r = 0;
            if (t >= 4096) {
              r += 13;
              t >>>= 13;
            }
            if (t >= 64) {
              r += 7;
              t >>>= 7;
            }
            if (t >= 8) {
              r += 4;
              t >>>= 4;
            }
            if (t >= 2) {
              r += 2;
              t >>>= 2;
            }
            return r + t;
          };
        }
        BN.prototype._zeroBits = function _zeroBits(w) {
          if (w === 0)
            return 26;
          var t = w;
          var r = 0;
          if ((t & 8191) === 0) {
            r += 13;
            t >>>= 13;
          }
          if ((t & 127) === 0) {
            r += 7;
            t >>>= 7;
          }
          if ((t & 15) === 0) {
            r += 4;
            t >>>= 4;
          }
          if ((t & 3) === 0) {
            r += 2;
            t >>>= 2;
          }
          if ((t & 1) === 0) {
            r++;
          }
          return r;
        };
        BN.prototype.bitLength = function bitLength() {
          var w = this.words[this.length - 1];
          var hi = this._countBits(w);
          return (this.length - 1) * 26 + hi;
        };
        function toBitArray(num) {
          var w = new Array(num.bitLength());
          for (var bit = 0; bit < w.length; bit++) {
            var off = bit / 26 | 0;
            var wbit = bit % 26;
            w[bit] = (num.words[off] & 1 << wbit) >>> wbit;
          }
          return w;
        }
        BN.prototype.zeroBits = function zeroBits() {
          if (this.isZero())
            return 0;
          var r = 0;
          for (var i = 0; i < this.length; i++) {
            var b = this._zeroBits(this.words[i]);
            r += b;
            if (b !== 26)
              break;
          }
          return r;
        };
        BN.prototype.byteLength = function byteLength() {
          return Math.ceil(this.bitLength() / 8);
        };
        BN.prototype.toTwos = function toTwos(width) {
          if (this.negative !== 0) {
            return this.abs().inotn(width).iaddn(1);
          }
          return this.clone();
        };
        BN.prototype.fromTwos = function fromTwos(width) {
          if (this.testn(width - 1)) {
            return this.notn(width).iaddn(1).ineg();
          }
          return this.clone();
        };
        BN.prototype.isNeg = function isNeg() {
          return this.negative !== 0;
        };
        BN.prototype.neg = function neg() {
          return this.clone().ineg();
        };
        BN.prototype.ineg = function ineg() {
          if (!this.isZero()) {
            this.negative ^= 1;
          }
          return this;
        };
        BN.prototype.iuor = function iuor(num) {
          while (this.length < num.length) {
            this.words[this.length++] = 0;
          }
          for (var i = 0; i < num.length; i++) {
            this.words[i] = this.words[i] | num.words[i];
          }
          return this.strip();
        };
        BN.prototype.ior = function ior(num) {
          assert2((this.negative | num.negative) === 0);
          return this.iuor(num);
        };
        BN.prototype.or = function or3(num) {
          if (this.length > num.length)
            return this.clone().ior(num);
          return num.clone().ior(this);
        };
        BN.prototype.uor = function uor(num) {
          if (this.length > num.length)
            return this.clone().iuor(num);
          return num.clone().iuor(this);
        };
        BN.prototype.iuand = function iuand(num) {
          var b;
          if (this.length > num.length) {
            b = num;
          } else {
            b = this;
          }
          for (var i = 0; i < b.length; i++) {
            this.words[i] = this.words[i] & num.words[i];
          }
          this.length = b.length;
          return this.strip();
        };
        BN.prototype.iand = function iand(num) {
          assert2((this.negative | num.negative) === 0);
          return this.iuand(num);
        };
        BN.prototype.and = function and(num) {
          if (this.length > num.length)
            return this.clone().iand(num);
          return num.clone().iand(this);
        };
        BN.prototype.uand = function uand(num) {
          if (this.length > num.length)
            return this.clone().iuand(num);
          return num.clone().iuand(this);
        };
        BN.prototype.iuxor = function iuxor(num) {
          var a;
          var b;
          if (this.length > num.length) {
            a = this;
            b = num;
          } else {
            a = num;
            b = this;
          }
          for (var i = 0; i < b.length; i++) {
            this.words[i] = a.words[i] ^ b.words[i];
          }
          if (this !== a) {
            for (; i < a.length; i++) {
              this.words[i] = a.words[i];
            }
          }
          this.length = a.length;
          return this.strip();
        };
        BN.prototype.ixor = function ixor(num) {
          assert2((this.negative | num.negative) === 0);
          return this.iuxor(num);
        };
        BN.prototype.xor = function xor3(num) {
          if (this.length > num.length)
            return this.clone().ixor(num);
          return num.clone().ixor(this);
        };
        BN.prototype.uxor = function uxor(num) {
          if (this.length > num.length)
            return this.clone().iuxor(num);
          return num.clone().iuxor(this);
        };
        BN.prototype.inotn = function inotn(width) {
          assert2(typeof width === "number" && width >= 0);
          var bytesNeeded = Math.ceil(width / 26) | 0;
          var bitsLeft = width % 26;
          this._expand(bytesNeeded);
          if (bitsLeft > 0) {
            bytesNeeded--;
          }
          for (var i = 0; i < bytesNeeded; i++) {
            this.words[i] = ~this.words[i] & 67108863;
          }
          if (bitsLeft > 0) {
            this.words[i] = ~this.words[i] & 67108863 >> 26 - bitsLeft;
          }
          return this.strip();
        };
        BN.prototype.notn = function notn(width) {
          return this.clone().inotn(width);
        };
        BN.prototype.setn = function setn(bit, val) {
          assert2(typeof bit === "number" && bit >= 0);
          var off = bit / 26 | 0;
          var wbit = bit % 26;
          this._expand(off + 1);
          if (val) {
            this.words[off] = this.words[off] | 1 << wbit;
          } else {
            this.words[off] = this.words[off] & ~(1 << wbit);
          }
          return this.strip();
        };
        BN.prototype.iadd = function iadd(num) {
          var r;
          if (this.negative !== 0 && num.negative === 0) {
            this.negative = 0;
            r = this.isub(num);
            this.negative ^= 1;
            return this._normSign();
          } else if (this.negative === 0 && num.negative !== 0) {
            num.negative = 0;
            r = this.isub(num);
            num.negative = 1;
            return r._normSign();
          }
          var a, b;
          if (this.length > num.length) {
            a = this;
            b = num;
          } else {
            a = num;
            b = this;
          }
          var carry = 0;
          for (var i = 0; i < b.length; i++) {
            r = (a.words[i] | 0) + (b.words[i] | 0) + carry;
            this.words[i] = r & 67108863;
            carry = r >>> 26;
          }
          for (; carry !== 0 && i < a.length; i++) {
            r = (a.words[i] | 0) + carry;
            this.words[i] = r & 67108863;
            carry = r >>> 26;
          }
          this.length = a.length;
          if (carry !== 0) {
            this.words[this.length] = carry;
            this.length++;
          } else if (a !== this) {
            for (; i < a.length; i++) {
              this.words[i] = a.words[i];
            }
          }
          return this;
        };
        BN.prototype.add = function add2(num) {
          var res;
          if (num.negative !== 0 && this.negative === 0) {
            num.negative = 0;
            res = this.sub(num);
            num.negative ^= 1;
            return res;
          } else if (num.negative === 0 && this.negative !== 0) {
            this.negative = 0;
            res = num.sub(this);
            this.negative = 1;
            return res;
          }
          if (this.length > num.length)
            return this.clone().iadd(num);
          return num.clone().iadd(this);
        };
        BN.prototype.isub = function isub(num) {
          if (num.negative !== 0) {
            num.negative = 0;
            var r = this.iadd(num);
            num.negative = 1;
            return r._normSign();
          } else if (this.negative !== 0) {
            this.negative = 0;
            this.iadd(num);
            this.negative = 1;
            return this._normSign();
          }
          var cmp = this.cmp(num);
          if (cmp === 0) {
            this.negative = 0;
            this.length = 1;
            this.words[0] = 0;
            return this;
          }
          var a, b;
          if (cmp > 0) {
            a = this;
            b = num;
          } else {
            a = num;
            b = this;
          }
          var carry = 0;
          for (var i = 0; i < b.length; i++) {
            r = (a.words[i] | 0) - (b.words[i] | 0) + carry;
            carry = r >> 26;
            this.words[i] = r & 67108863;
          }
          for (; carry !== 0 && i < a.length; i++) {
            r = (a.words[i] | 0) + carry;
            carry = r >> 26;
            this.words[i] = r & 67108863;
          }
          if (carry === 0 && i < a.length && a !== this) {
            for (; i < a.length; i++) {
              this.words[i] = a.words[i];
            }
          }
          this.length = Math.max(this.length, i);
          if (a !== this) {
            this.negative = 1;
          }
          return this.strip();
        };
        BN.prototype.sub = function sub(num) {
          return this.clone().isub(num);
        };
        function smallMulTo(self2, num, out) {
          out.negative = num.negative ^ self2.negative;
          var len = self2.length + num.length | 0;
          out.length = len;
          len = len - 1 | 0;
          var a = self2.words[0] | 0;
          var b = num.words[0] | 0;
          var r = a * b;
          var lo = r & 67108863;
          var carry = r / 67108864 | 0;
          out.words[0] = lo;
          for (var k = 1; k < len; k++) {
            var ncarry = carry >>> 26;
            var rword = carry & 67108863;
            var maxJ = Math.min(k, num.length - 1);
            for (var j = Math.max(0, k - self2.length + 1); j <= maxJ; j++) {
              var i = k - j | 0;
              a = self2.words[i] | 0;
              b = num.words[j] | 0;
              r = a * b + rword;
              ncarry += r / 67108864 | 0;
              rword = r & 67108863;
            }
            out.words[k] = rword | 0;
            carry = ncarry | 0;
          }
          if (carry !== 0) {
            out.words[k] = carry | 0;
          } else {
            out.length--;
          }
          return out.strip();
        }
        var comb10MulTo = function comb10MulTo2(self2, num, out) {
          var a = self2.words;
          var b = num.words;
          var o = out.words;
          var c = 0;
          var lo;
          var mid;
          var hi;
          var a0 = a[0] | 0;
          var al0 = a0 & 8191;
          var ah0 = a0 >>> 13;
          var a1 = a[1] | 0;
          var al1 = a1 & 8191;
          var ah1 = a1 >>> 13;
          var a2 = a[2] | 0;
          var al2 = a2 & 8191;
          var ah2 = a2 >>> 13;
          var a3 = a[3] | 0;
          var al3 = a3 & 8191;
          var ah3 = a3 >>> 13;
          var a4 = a[4] | 0;
          var al4 = a4 & 8191;
          var ah4 = a4 >>> 13;
          var a5 = a[5] | 0;
          var al5 = a5 & 8191;
          var ah5 = a5 >>> 13;
          var a6 = a[6] | 0;
          var al6 = a6 & 8191;
          var ah6 = a6 >>> 13;
          var a7 = a[7] | 0;
          var al7 = a7 & 8191;
          var ah7 = a7 >>> 13;
          var a8 = a[8] | 0;
          var al8 = a8 & 8191;
          var ah8 = a8 >>> 13;
          var a9 = a[9] | 0;
          var al9 = a9 & 8191;
          var ah9 = a9 >>> 13;
          var b0 = b[0] | 0;
          var bl0 = b0 & 8191;
          var bh0 = b0 >>> 13;
          var b1 = b[1] | 0;
          var bl1 = b1 & 8191;
          var bh1 = b1 >>> 13;
          var b2 = b[2] | 0;
          var bl2 = b2 & 8191;
          var bh2 = b2 >>> 13;
          var b3 = b[3] | 0;
          var bl3 = b3 & 8191;
          var bh3 = b3 >>> 13;
          var b4 = b[4] | 0;
          var bl4 = b4 & 8191;
          var bh4 = b4 >>> 13;
          var b5 = b[5] | 0;
          var bl5 = b5 & 8191;
          var bh5 = b5 >>> 13;
          var b6 = b[6] | 0;
          var bl6 = b6 & 8191;
          var bh6 = b6 >>> 13;
          var b7 = b[7] | 0;
          var bl7 = b7 & 8191;
          var bh7 = b7 >>> 13;
          var b8 = b[8] | 0;
          var bl8 = b8 & 8191;
          var bh8 = b8 >>> 13;
          var b9 = b[9] | 0;
          var bl9 = b9 & 8191;
          var bh9 = b9 >>> 13;
          out.negative = self2.negative ^ num.negative;
          out.length = 19;
          lo = Math.imul(al0, bl0);
          mid = Math.imul(al0, bh0);
          mid = mid + Math.imul(ah0, bl0) | 0;
          hi = Math.imul(ah0, bh0);
          var w0 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w0 >>> 26) | 0;
          w0 &= 67108863;
          lo = Math.imul(al1, bl0);
          mid = Math.imul(al1, bh0);
          mid = mid + Math.imul(ah1, bl0) | 0;
          hi = Math.imul(ah1, bh0);
          lo = lo + Math.imul(al0, bl1) | 0;
          mid = mid + Math.imul(al0, bh1) | 0;
          mid = mid + Math.imul(ah0, bl1) | 0;
          hi = hi + Math.imul(ah0, bh1) | 0;
          var w1 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w1 >>> 26) | 0;
          w1 &= 67108863;
          lo = Math.imul(al2, bl0);
          mid = Math.imul(al2, bh0);
          mid = mid + Math.imul(ah2, bl0) | 0;
          hi = Math.imul(ah2, bh0);
          lo = lo + Math.imul(al1, bl1) | 0;
          mid = mid + Math.imul(al1, bh1) | 0;
          mid = mid + Math.imul(ah1, bl1) | 0;
          hi = hi + Math.imul(ah1, bh1) | 0;
          lo = lo + Math.imul(al0, bl2) | 0;
          mid = mid + Math.imul(al0, bh2) | 0;
          mid = mid + Math.imul(ah0, bl2) | 0;
          hi = hi + Math.imul(ah0, bh2) | 0;
          var w2 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w2 >>> 26) | 0;
          w2 &= 67108863;
          lo = Math.imul(al3, bl0);
          mid = Math.imul(al3, bh0);
          mid = mid + Math.imul(ah3, bl0) | 0;
          hi = Math.imul(ah3, bh0);
          lo = lo + Math.imul(al2, bl1) | 0;
          mid = mid + Math.imul(al2, bh1) | 0;
          mid = mid + Math.imul(ah2, bl1) | 0;
          hi = hi + Math.imul(ah2, bh1) | 0;
          lo = lo + Math.imul(al1, bl2) | 0;
          mid = mid + Math.imul(al1, bh2) | 0;
          mid = mid + Math.imul(ah1, bl2) | 0;
          hi = hi + Math.imul(ah1, bh2) | 0;
          lo = lo + Math.imul(al0, bl3) | 0;
          mid = mid + Math.imul(al0, bh3) | 0;
          mid = mid + Math.imul(ah0, bl3) | 0;
          hi = hi + Math.imul(ah0, bh3) | 0;
          var w3 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w3 >>> 26) | 0;
          w3 &= 67108863;
          lo = Math.imul(al4, bl0);
          mid = Math.imul(al4, bh0);
          mid = mid + Math.imul(ah4, bl0) | 0;
          hi = Math.imul(ah4, bh0);
          lo = lo + Math.imul(al3, bl1) | 0;
          mid = mid + Math.imul(al3, bh1) | 0;
          mid = mid + Math.imul(ah3, bl1) | 0;
          hi = hi + Math.imul(ah3, bh1) | 0;
          lo = lo + Math.imul(al2, bl2) | 0;
          mid = mid + Math.imul(al2, bh2) | 0;
          mid = mid + Math.imul(ah2, bl2) | 0;
          hi = hi + Math.imul(ah2, bh2) | 0;
          lo = lo + Math.imul(al1, bl3) | 0;
          mid = mid + Math.imul(al1, bh3) | 0;
          mid = mid + Math.imul(ah1, bl3) | 0;
          hi = hi + Math.imul(ah1, bh3) | 0;
          lo = lo + Math.imul(al0, bl4) | 0;
          mid = mid + Math.imul(al0, bh4) | 0;
          mid = mid + Math.imul(ah0, bl4) | 0;
          hi = hi + Math.imul(ah0, bh4) | 0;
          var w4 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w4 >>> 26) | 0;
          w4 &= 67108863;
          lo = Math.imul(al5, bl0);
          mid = Math.imul(al5, bh0);
          mid = mid + Math.imul(ah5, bl0) | 0;
          hi = Math.imul(ah5, bh0);
          lo = lo + Math.imul(al4, bl1) | 0;
          mid = mid + Math.imul(al4, bh1) | 0;
          mid = mid + Math.imul(ah4, bl1) | 0;
          hi = hi + Math.imul(ah4, bh1) | 0;
          lo = lo + Math.imul(al3, bl2) | 0;
          mid = mid + Math.imul(al3, bh2) | 0;
          mid = mid + Math.imul(ah3, bl2) | 0;
          hi = hi + Math.imul(ah3, bh2) | 0;
          lo = lo + Math.imul(al2, bl3) | 0;
          mid = mid + Math.imul(al2, bh3) | 0;
          mid = mid + Math.imul(ah2, bl3) | 0;
          hi = hi + Math.imul(ah2, bh3) | 0;
          lo = lo + Math.imul(al1, bl4) | 0;
          mid = mid + Math.imul(al1, bh4) | 0;
          mid = mid + Math.imul(ah1, bl4) | 0;
          hi = hi + Math.imul(ah1, bh4) | 0;
          lo = lo + Math.imul(al0, bl5) | 0;
          mid = mid + Math.imul(al0, bh5) | 0;
          mid = mid + Math.imul(ah0, bl5) | 0;
          hi = hi + Math.imul(ah0, bh5) | 0;
          var w5 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w5 >>> 26) | 0;
          w5 &= 67108863;
          lo = Math.imul(al6, bl0);
          mid = Math.imul(al6, bh0);
          mid = mid + Math.imul(ah6, bl0) | 0;
          hi = Math.imul(ah6, bh0);
          lo = lo + Math.imul(al5, bl1) | 0;
          mid = mid + Math.imul(al5, bh1) | 0;
          mid = mid + Math.imul(ah5, bl1) | 0;
          hi = hi + Math.imul(ah5, bh1) | 0;
          lo = lo + Math.imul(al4, bl2) | 0;
          mid = mid + Math.imul(al4, bh2) | 0;
          mid = mid + Math.imul(ah4, bl2) | 0;
          hi = hi + Math.imul(ah4, bh2) | 0;
          lo = lo + Math.imul(al3, bl3) | 0;
          mid = mid + Math.imul(al3, bh3) | 0;
          mid = mid + Math.imul(ah3, bl3) | 0;
          hi = hi + Math.imul(ah3, bh3) | 0;
          lo = lo + Math.imul(al2, bl4) | 0;
          mid = mid + Math.imul(al2, bh4) | 0;
          mid = mid + Math.imul(ah2, bl4) | 0;
          hi = hi + Math.imul(ah2, bh4) | 0;
          lo = lo + Math.imul(al1, bl5) | 0;
          mid = mid + Math.imul(al1, bh5) | 0;
          mid = mid + Math.imul(ah1, bl5) | 0;
          hi = hi + Math.imul(ah1, bh5) | 0;
          lo = lo + Math.imul(al0, bl6) | 0;
          mid = mid + Math.imul(al0, bh6) | 0;
          mid = mid + Math.imul(ah0, bl6) | 0;
          hi = hi + Math.imul(ah0, bh6) | 0;
          var w6 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w6 >>> 26) | 0;
          w6 &= 67108863;
          lo = Math.imul(al7, bl0);
          mid = Math.imul(al7, bh0);
          mid = mid + Math.imul(ah7, bl0) | 0;
          hi = Math.imul(ah7, bh0);
          lo = lo + Math.imul(al6, bl1) | 0;
          mid = mid + Math.imul(al6, bh1) | 0;
          mid = mid + Math.imul(ah6, bl1) | 0;
          hi = hi + Math.imul(ah6, bh1) | 0;
          lo = lo + Math.imul(al5, bl2) | 0;
          mid = mid + Math.imul(al5, bh2) | 0;
          mid = mid + Math.imul(ah5, bl2) | 0;
          hi = hi + Math.imul(ah5, bh2) | 0;
          lo = lo + Math.imul(al4, bl3) | 0;
          mid = mid + Math.imul(al4, bh3) | 0;
          mid = mid + Math.imul(ah4, bl3) | 0;
          hi = hi + Math.imul(ah4, bh3) | 0;
          lo = lo + Math.imul(al3, bl4) | 0;
          mid = mid + Math.imul(al3, bh4) | 0;
          mid = mid + Math.imul(ah3, bl4) | 0;
          hi = hi + Math.imul(ah3, bh4) | 0;
          lo = lo + Math.imul(al2, bl5) | 0;
          mid = mid + Math.imul(al2, bh5) | 0;
          mid = mid + Math.imul(ah2, bl5) | 0;
          hi = hi + Math.imul(ah2, bh5) | 0;
          lo = lo + Math.imul(al1, bl6) | 0;
          mid = mid + Math.imul(al1, bh6) | 0;
          mid = mid + Math.imul(ah1, bl6) | 0;
          hi = hi + Math.imul(ah1, bh6) | 0;
          lo = lo + Math.imul(al0, bl7) | 0;
          mid = mid + Math.imul(al0, bh7) | 0;
          mid = mid + Math.imul(ah0, bl7) | 0;
          hi = hi + Math.imul(ah0, bh7) | 0;
          var w7 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w7 >>> 26) | 0;
          w7 &= 67108863;
          lo = Math.imul(al8, bl0);
          mid = Math.imul(al8, bh0);
          mid = mid + Math.imul(ah8, bl0) | 0;
          hi = Math.imul(ah8, bh0);
          lo = lo + Math.imul(al7, bl1) | 0;
          mid = mid + Math.imul(al7, bh1) | 0;
          mid = mid + Math.imul(ah7, bl1) | 0;
          hi = hi + Math.imul(ah7, bh1) | 0;
          lo = lo + Math.imul(al6, bl2) | 0;
          mid = mid + Math.imul(al6, bh2) | 0;
          mid = mid + Math.imul(ah6, bl2) | 0;
          hi = hi + Math.imul(ah6, bh2) | 0;
          lo = lo + Math.imul(al5, bl3) | 0;
          mid = mid + Math.imul(al5, bh3) | 0;
          mid = mid + Math.imul(ah5, bl3) | 0;
          hi = hi + Math.imul(ah5, bh3) | 0;
          lo = lo + Math.imul(al4, bl4) | 0;
          mid = mid + Math.imul(al4, bh4) | 0;
          mid = mid + Math.imul(ah4, bl4) | 0;
          hi = hi + Math.imul(ah4, bh4) | 0;
          lo = lo + Math.imul(al3, bl5) | 0;
          mid = mid + Math.imul(al3, bh5) | 0;
          mid = mid + Math.imul(ah3, bl5) | 0;
          hi = hi + Math.imul(ah3, bh5) | 0;
          lo = lo + Math.imul(al2, bl6) | 0;
          mid = mid + Math.imul(al2, bh6) | 0;
          mid = mid + Math.imul(ah2, bl6) | 0;
          hi = hi + Math.imul(ah2, bh6) | 0;
          lo = lo + Math.imul(al1, bl7) | 0;
          mid = mid + Math.imul(al1, bh7) | 0;
          mid = mid + Math.imul(ah1, bl7) | 0;
          hi = hi + Math.imul(ah1, bh7) | 0;
          lo = lo + Math.imul(al0, bl8) | 0;
          mid = mid + Math.imul(al0, bh8) | 0;
          mid = mid + Math.imul(ah0, bl8) | 0;
          hi = hi + Math.imul(ah0, bh8) | 0;
          var w8 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w8 >>> 26) | 0;
          w8 &= 67108863;
          lo = Math.imul(al9, bl0);
          mid = Math.imul(al9, bh0);
          mid = mid + Math.imul(ah9, bl0) | 0;
          hi = Math.imul(ah9, bh0);
          lo = lo + Math.imul(al8, bl1) | 0;
          mid = mid + Math.imul(al8, bh1) | 0;
          mid = mid + Math.imul(ah8, bl1) | 0;
          hi = hi + Math.imul(ah8, bh1) | 0;
          lo = lo + Math.imul(al7, bl2) | 0;
          mid = mid + Math.imul(al7, bh2) | 0;
          mid = mid + Math.imul(ah7, bl2) | 0;
          hi = hi + Math.imul(ah7, bh2) | 0;
          lo = lo + Math.imul(al6, bl3) | 0;
          mid = mid + Math.imul(al6, bh3) | 0;
          mid = mid + Math.imul(ah6, bl3) | 0;
          hi = hi + Math.imul(ah6, bh3) | 0;
          lo = lo + Math.imul(al5, bl4) | 0;
          mid = mid + Math.imul(al5, bh4) | 0;
          mid = mid + Math.imul(ah5, bl4) | 0;
          hi = hi + Math.imul(ah5, bh4) | 0;
          lo = lo + Math.imul(al4, bl5) | 0;
          mid = mid + Math.imul(al4, bh5) | 0;
          mid = mid + Math.imul(ah4, bl5) | 0;
          hi = hi + Math.imul(ah4, bh5) | 0;
          lo = lo + Math.imul(al3, bl6) | 0;
          mid = mid + Math.imul(al3, bh6) | 0;
          mid = mid + Math.imul(ah3, bl6) | 0;
          hi = hi + Math.imul(ah3, bh6) | 0;
          lo = lo + Math.imul(al2, bl7) | 0;
          mid = mid + Math.imul(al2, bh7) | 0;
          mid = mid + Math.imul(ah2, bl7) | 0;
          hi = hi + Math.imul(ah2, bh7) | 0;
          lo = lo + Math.imul(al1, bl8) | 0;
          mid = mid + Math.imul(al1, bh8) | 0;
          mid = mid + Math.imul(ah1, bl8) | 0;
          hi = hi + Math.imul(ah1, bh8) | 0;
          lo = lo + Math.imul(al0, bl9) | 0;
          mid = mid + Math.imul(al0, bh9) | 0;
          mid = mid + Math.imul(ah0, bl9) | 0;
          hi = hi + Math.imul(ah0, bh9) | 0;
          var w9 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w9 >>> 26) | 0;
          w9 &= 67108863;
          lo = Math.imul(al9, bl1);
          mid = Math.imul(al9, bh1);
          mid = mid + Math.imul(ah9, bl1) | 0;
          hi = Math.imul(ah9, bh1);
          lo = lo + Math.imul(al8, bl2) | 0;
          mid = mid + Math.imul(al8, bh2) | 0;
          mid = mid + Math.imul(ah8, bl2) | 0;
          hi = hi + Math.imul(ah8, bh2) | 0;
          lo = lo + Math.imul(al7, bl3) | 0;
          mid = mid + Math.imul(al7, bh3) | 0;
          mid = mid + Math.imul(ah7, bl3) | 0;
          hi = hi + Math.imul(ah7, bh3) | 0;
          lo = lo + Math.imul(al6, bl4) | 0;
          mid = mid + Math.imul(al6, bh4) | 0;
          mid = mid + Math.imul(ah6, bl4) | 0;
          hi = hi + Math.imul(ah6, bh4) | 0;
          lo = lo + Math.imul(al5, bl5) | 0;
          mid = mid + Math.imul(al5, bh5) | 0;
          mid = mid + Math.imul(ah5, bl5) | 0;
          hi = hi + Math.imul(ah5, bh5) | 0;
          lo = lo + Math.imul(al4, bl6) | 0;
          mid = mid + Math.imul(al4, bh6) | 0;
          mid = mid + Math.imul(ah4, bl6) | 0;
          hi = hi + Math.imul(ah4, bh6) | 0;
          lo = lo + Math.imul(al3, bl7) | 0;
          mid = mid + Math.imul(al3, bh7) | 0;
          mid = mid + Math.imul(ah3, bl7) | 0;
          hi = hi + Math.imul(ah3, bh7) | 0;
          lo = lo + Math.imul(al2, bl8) | 0;
          mid = mid + Math.imul(al2, bh8) | 0;
          mid = mid + Math.imul(ah2, bl8) | 0;
          hi = hi + Math.imul(ah2, bh8) | 0;
          lo = lo + Math.imul(al1, bl9) | 0;
          mid = mid + Math.imul(al1, bh9) | 0;
          mid = mid + Math.imul(ah1, bl9) | 0;
          hi = hi + Math.imul(ah1, bh9) | 0;
          var w10 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w10 >>> 26) | 0;
          w10 &= 67108863;
          lo = Math.imul(al9, bl2);
          mid = Math.imul(al9, bh2);
          mid = mid + Math.imul(ah9, bl2) | 0;
          hi = Math.imul(ah9, bh2);
          lo = lo + Math.imul(al8, bl3) | 0;
          mid = mid + Math.imul(al8, bh3) | 0;
          mid = mid + Math.imul(ah8, bl3) | 0;
          hi = hi + Math.imul(ah8, bh3) | 0;
          lo = lo + Math.imul(al7, bl4) | 0;
          mid = mid + Math.imul(al7, bh4) | 0;
          mid = mid + Math.imul(ah7, bl4) | 0;
          hi = hi + Math.imul(ah7, bh4) | 0;
          lo = lo + Math.imul(al6, bl5) | 0;
          mid = mid + Math.imul(al6, bh5) | 0;
          mid = mid + Math.imul(ah6, bl5) | 0;
          hi = hi + Math.imul(ah6, bh5) | 0;
          lo = lo + Math.imul(al5, bl6) | 0;
          mid = mid + Math.imul(al5, bh6) | 0;
          mid = mid + Math.imul(ah5, bl6) | 0;
          hi = hi + Math.imul(ah5, bh6) | 0;
          lo = lo + Math.imul(al4, bl7) | 0;
          mid = mid + Math.imul(al4, bh7) | 0;
          mid = mid + Math.imul(ah4, bl7) | 0;
          hi = hi + Math.imul(ah4, bh7) | 0;
          lo = lo + Math.imul(al3, bl8) | 0;
          mid = mid + Math.imul(al3, bh8) | 0;
          mid = mid + Math.imul(ah3, bl8) | 0;
          hi = hi + Math.imul(ah3, bh8) | 0;
          lo = lo + Math.imul(al2, bl9) | 0;
          mid = mid + Math.imul(al2, bh9) | 0;
          mid = mid + Math.imul(ah2, bl9) | 0;
          hi = hi + Math.imul(ah2, bh9) | 0;
          var w11 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w11 >>> 26) | 0;
          w11 &= 67108863;
          lo = Math.imul(al9, bl3);
          mid = Math.imul(al9, bh3);
          mid = mid + Math.imul(ah9, bl3) | 0;
          hi = Math.imul(ah9, bh3);
          lo = lo + Math.imul(al8, bl4) | 0;
          mid = mid + Math.imul(al8, bh4) | 0;
          mid = mid + Math.imul(ah8, bl4) | 0;
          hi = hi + Math.imul(ah8, bh4) | 0;
          lo = lo + Math.imul(al7, bl5) | 0;
          mid = mid + Math.imul(al7, bh5) | 0;
          mid = mid + Math.imul(ah7, bl5) | 0;
          hi = hi + Math.imul(ah7, bh5) | 0;
          lo = lo + Math.imul(al6, bl6) | 0;
          mid = mid + Math.imul(al6, bh6) | 0;
          mid = mid + Math.imul(ah6, bl6) | 0;
          hi = hi + Math.imul(ah6, bh6) | 0;
          lo = lo + Math.imul(al5, bl7) | 0;
          mid = mid + Math.imul(al5, bh7) | 0;
          mid = mid + Math.imul(ah5, bl7) | 0;
          hi = hi + Math.imul(ah5, bh7) | 0;
          lo = lo + Math.imul(al4, bl8) | 0;
          mid = mid + Math.imul(al4, bh8) | 0;
          mid = mid + Math.imul(ah4, bl8) | 0;
          hi = hi + Math.imul(ah4, bh8) | 0;
          lo = lo + Math.imul(al3, bl9) | 0;
          mid = mid + Math.imul(al3, bh9) | 0;
          mid = mid + Math.imul(ah3, bl9) | 0;
          hi = hi + Math.imul(ah3, bh9) | 0;
          var w12 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w12 >>> 26) | 0;
          w12 &= 67108863;
          lo = Math.imul(al9, bl4);
          mid = Math.imul(al9, bh4);
          mid = mid + Math.imul(ah9, bl4) | 0;
          hi = Math.imul(ah9, bh4);
          lo = lo + Math.imul(al8, bl5) | 0;
          mid = mid + Math.imul(al8, bh5) | 0;
          mid = mid + Math.imul(ah8, bl5) | 0;
          hi = hi + Math.imul(ah8, bh5) | 0;
          lo = lo + Math.imul(al7, bl6) | 0;
          mid = mid + Math.imul(al7, bh6) | 0;
          mid = mid + Math.imul(ah7, bl6) | 0;
          hi = hi + Math.imul(ah7, bh6) | 0;
          lo = lo + Math.imul(al6, bl7) | 0;
          mid = mid + Math.imul(al6, bh7) | 0;
          mid = mid + Math.imul(ah6, bl7) | 0;
          hi = hi + Math.imul(ah6, bh7) | 0;
          lo = lo + Math.imul(al5, bl8) | 0;
          mid = mid + Math.imul(al5, bh8) | 0;
          mid = mid + Math.imul(ah5, bl8) | 0;
          hi = hi + Math.imul(ah5, bh8) | 0;
          lo = lo + Math.imul(al4, bl9) | 0;
          mid = mid + Math.imul(al4, bh9) | 0;
          mid = mid + Math.imul(ah4, bl9) | 0;
          hi = hi + Math.imul(ah4, bh9) | 0;
          var w13 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w13 >>> 26) | 0;
          w13 &= 67108863;
          lo = Math.imul(al9, bl5);
          mid = Math.imul(al9, bh5);
          mid = mid + Math.imul(ah9, bl5) | 0;
          hi = Math.imul(ah9, bh5);
          lo = lo + Math.imul(al8, bl6) | 0;
          mid = mid + Math.imul(al8, bh6) | 0;
          mid = mid + Math.imul(ah8, bl6) | 0;
          hi = hi + Math.imul(ah8, bh6) | 0;
          lo = lo + Math.imul(al7, bl7) | 0;
          mid = mid + Math.imul(al7, bh7) | 0;
          mid = mid + Math.imul(ah7, bl7) | 0;
          hi = hi + Math.imul(ah7, bh7) | 0;
          lo = lo + Math.imul(al6, bl8) | 0;
          mid = mid + Math.imul(al6, bh8) | 0;
          mid = mid + Math.imul(ah6, bl8) | 0;
          hi = hi + Math.imul(ah6, bh8) | 0;
          lo = lo + Math.imul(al5, bl9) | 0;
          mid = mid + Math.imul(al5, bh9) | 0;
          mid = mid + Math.imul(ah5, bl9) | 0;
          hi = hi + Math.imul(ah5, bh9) | 0;
          var w14 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w14 >>> 26) | 0;
          w14 &= 67108863;
          lo = Math.imul(al9, bl6);
          mid = Math.imul(al9, bh6);
          mid = mid + Math.imul(ah9, bl6) | 0;
          hi = Math.imul(ah9, bh6);
          lo = lo + Math.imul(al8, bl7) | 0;
          mid = mid + Math.imul(al8, bh7) | 0;
          mid = mid + Math.imul(ah8, bl7) | 0;
          hi = hi + Math.imul(ah8, bh7) | 0;
          lo = lo + Math.imul(al7, bl8) | 0;
          mid = mid + Math.imul(al7, bh8) | 0;
          mid = mid + Math.imul(ah7, bl8) | 0;
          hi = hi + Math.imul(ah7, bh8) | 0;
          lo = lo + Math.imul(al6, bl9) | 0;
          mid = mid + Math.imul(al6, bh9) | 0;
          mid = mid + Math.imul(ah6, bl9) | 0;
          hi = hi + Math.imul(ah6, bh9) | 0;
          var w15 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w15 >>> 26) | 0;
          w15 &= 67108863;
          lo = Math.imul(al9, bl7);
          mid = Math.imul(al9, bh7);
          mid = mid + Math.imul(ah9, bl7) | 0;
          hi = Math.imul(ah9, bh7);
          lo = lo + Math.imul(al8, bl8) | 0;
          mid = mid + Math.imul(al8, bh8) | 0;
          mid = mid + Math.imul(ah8, bl8) | 0;
          hi = hi + Math.imul(ah8, bh8) | 0;
          lo = lo + Math.imul(al7, bl9) | 0;
          mid = mid + Math.imul(al7, bh9) | 0;
          mid = mid + Math.imul(ah7, bl9) | 0;
          hi = hi + Math.imul(ah7, bh9) | 0;
          var w16 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w16 >>> 26) | 0;
          w16 &= 67108863;
          lo = Math.imul(al9, bl8);
          mid = Math.imul(al9, bh8);
          mid = mid + Math.imul(ah9, bl8) | 0;
          hi = Math.imul(ah9, bh8);
          lo = lo + Math.imul(al8, bl9) | 0;
          mid = mid + Math.imul(al8, bh9) | 0;
          mid = mid + Math.imul(ah8, bl9) | 0;
          hi = hi + Math.imul(ah8, bh9) | 0;
          var w17 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w17 >>> 26) | 0;
          w17 &= 67108863;
          lo = Math.imul(al9, bl9);
          mid = Math.imul(al9, bh9);
          mid = mid + Math.imul(ah9, bl9) | 0;
          hi = Math.imul(ah9, bh9);
          var w18 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
          c = (hi + (mid >>> 13) | 0) + (w18 >>> 26) | 0;
          w18 &= 67108863;
          o[0] = w0;
          o[1] = w1;
          o[2] = w2;
          o[3] = w3;
          o[4] = w4;
          o[5] = w5;
          o[6] = w6;
          o[7] = w7;
          o[8] = w8;
          o[9] = w9;
          o[10] = w10;
          o[11] = w11;
          o[12] = w12;
          o[13] = w13;
          o[14] = w14;
          o[15] = w15;
          o[16] = w16;
          o[17] = w17;
          o[18] = w18;
          if (c !== 0) {
            o[19] = c;
            out.length++;
          }
          return out;
        };
        if (!Math.imul) {
          comb10MulTo = smallMulTo;
        }
        function bigMulTo(self2, num, out) {
          out.negative = num.negative ^ self2.negative;
          out.length = self2.length + num.length;
          var carry = 0;
          var hncarry = 0;
          for (var k = 0; k < out.length - 1; k++) {
            var ncarry = hncarry;
            hncarry = 0;
            var rword = carry & 67108863;
            var maxJ = Math.min(k, num.length - 1);
            for (var j = Math.max(0, k - self2.length + 1); j <= maxJ; j++) {
              var i = k - j;
              var a = self2.words[i] | 0;
              var b = num.words[j] | 0;
              var r = a * b;
              var lo = r & 67108863;
              ncarry = ncarry + (r / 67108864 | 0) | 0;
              lo = lo + rword | 0;
              rword = lo & 67108863;
              ncarry = ncarry + (lo >>> 26) | 0;
              hncarry += ncarry >>> 26;
              ncarry &= 67108863;
            }
            out.words[k] = rword;
            carry = ncarry;
            ncarry = hncarry;
          }
          if (carry !== 0) {
            out.words[k] = carry;
          } else {
            out.length--;
          }
          return out.strip();
        }
        function jumboMulTo(self2, num, out) {
          var fftm = new FFTM();
          return fftm.mulp(self2, num, out);
        }
        BN.prototype.mulTo = function mulTo(num, out) {
          var res;
          var len = this.length + num.length;
          if (this.length === 10 && num.length === 10) {
            res = comb10MulTo(this, num, out);
          } else if (len < 63) {
            res = smallMulTo(this, num, out);
          } else if (len < 1024) {
            res = bigMulTo(this, num, out);
          } else {
            res = jumboMulTo(this, num, out);
          }
          return res;
        };
        function FFTM(x, y) {
          this.x = x;
          this.y = y;
        }
        FFTM.prototype.makeRBT = function makeRBT(N) {
          var t = new Array(N);
          var l = BN.prototype._countBits(N) - 1;
          for (var i = 0; i < N; i++) {
            t[i] = this.revBin(i, l, N);
          }
          return t;
        };
        FFTM.prototype.revBin = function revBin(x, l, N) {
          if (x === 0 || x === N - 1)
            return x;
          var rb = 0;
          for (var i = 0; i < l; i++) {
            rb |= (x & 1) << l - i - 1;
            x >>= 1;
          }
          return rb;
        };
        FFTM.prototype.permute = function permute(rbt, rws, iws, rtws, itws, N) {
          for (var i = 0; i < N; i++) {
            rtws[i] = rws[rbt[i]];
            itws[i] = iws[rbt[i]];
          }
        };
        FFTM.prototype.transform = function transform(rws, iws, rtws, itws, N, rbt) {
          this.permute(rbt, rws, iws, rtws, itws, N);
          for (var s = 1; s < N; s <<= 1) {
            var l = s << 1;
            var rtwdf = Math.cos(2 * Math.PI / l);
            var itwdf = Math.sin(2 * Math.PI / l);
            for (var p = 0; p < N; p += l) {
              var rtwdf_ = rtwdf;
              var itwdf_ = itwdf;
              for (var j = 0; j < s; j++) {
                var re = rtws[p + j];
                var ie = itws[p + j];
                var ro = rtws[p + j + s];
                var io = itws[p + j + s];
                var rx = rtwdf_ * ro - itwdf_ * io;
                io = rtwdf_ * io + itwdf_ * ro;
                ro = rx;
                rtws[p + j] = re + ro;
                itws[p + j] = ie + io;
                rtws[p + j + s] = re - ro;
                itws[p + j + s] = ie - io;
                if (j !== l) {
                  rx = rtwdf * rtwdf_ - itwdf * itwdf_;
                  itwdf_ = rtwdf * itwdf_ + itwdf * rtwdf_;
                  rtwdf_ = rx;
                }
              }
            }
          }
        };
        FFTM.prototype.guessLen13b = function guessLen13b(n, m) {
          var N = Math.max(m, n) | 1;
          var odd = N & 1;
          var i = 0;
          for (N = N / 2 | 0; N; N = N >>> 1) {
            i++;
          }
          return 1 << i + 1 + odd;
        };
        FFTM.prototype.conjugate = function conjugate(rws, iws, N) {
          if (N <= 1)
            return;
          for (var i = 0; i < N / 2; i++) {
            var t = rws[i];
            rws[i] = rws[N - i - 1];
            rws[N - i - 1] = t;
            t = iws[i];
            iws[i] = -iws[N - i - 1];
            iws[N - i - 1] = -t;
          }
        };
        FFTM.prototype.normalize13b = function normalize13b(ws, N) {
          var carry = 0;
          for (var i = 0; i < N / 2; i++) {
            var w = Math.round(ws[2 * i + 1] / N) * 8192 + Math.round(ws[2 * i] / N) + carry;
            ws[i] = w & 67108863;
            if (w < 67108864) {
              carry = 0;
            } else {
              carry = w / 67108864 | 0;
            }
          }
          return ws;
        };
        FFTM.prototype.convert13b = function convert13b(ws, len, rws, N) {
          var carry = 0;
          for (var i = 0; i < len; i++) {
            carry = carry + (ws[i] | 0);
            rws[2 * i] = carry & 8191;
            carry = carry >>> 13;
            rws[2 * i + 1] = carry & 8191;
            carry = carry >>> 13;
          }
          for (i = 2 * len; i < N; ++i) {
            rws[i] = 0;
          }
          assert2(carry === 0);
          assert2((carry & ~8191) === 0);
        };
        FFTM.prototype.stub = function stub(N) {
          var ph = new Array(N);
          for (var i = 0; i < N; i++) {
            ph[i] = 0;
          }
          return ph;
        };
        FFTM.prototype.mulp = function mulp(x, y, out) {
          var N = 2 * this.guessLen13b(x.length, y.length);
          var rbt = this.makeRBT(N);
          var _ = this.stub(N);
          var rws = new Array(N);
          var rwst = new Array(N);
          var iwst = new Array(N);
          var nrws = new Array(N);
          var nrwst = new Array(N);
          var niwst = new Array(N);
          var rmws = out.words;
          rmws.length = N;
          this.convert13b(x.words, x.length, rws, N);
          this.convert13b(y.words, y.length, nrws, N);
          this.transform(rws, _, rwst, iwst, N, rbt);
          this.transform(nrws, _, nrwst, niwst, N, rbt);
          for (var i = 0; i < N; i++) {
            var rx = rwst[i] * nrwst[i] - iwst[i] * niwst[i];
            iwst[i] = rwst[i] * niwst[i] + iwst[i] * nrwst[i];
            rwst[i] = rx;
          }
          this.conjugate(rwst, iwst, N);
          this.transform(rwst, iwst, rmws, _, N, rbt);
          this.conjugate(rmws, _, N);
          this.normalize13b(rmws, N);
          out.negative = x.negative ^ y.negative;
          out.length = x.length + y.length;
          return out.strip();
        };
        BN.prototype.mul = function mul(num) {
          var out = new BN(null);
          out.words = new Array(this.length + num.length);
          return this.mulTo(num, out);
        };
        BN.prototype.mulf = function mulf(num) {
          var out = new BN(null);
          out.words = new Array(this.length + num.length);
          return jumboMulTo(this, num, out);
        };
        BN.prototype.imul = function imul(num) {
          return this.clone().mulTo(num, this);
        };
        BN.prototype.imuln = function imuln(num) {
          assert2(typeof num === "number");
          assert2(num < 67108864);
          var carry = 0;
          for (var i = 0; i < this.length; i++) {
            var w = (this.words[i] | 0) * num;
            var lo = (w & 67108863) + (carry & 67108863);
            carry >>= 26;
            carry += w / 67108864 | 0;
            carry += lo >>> 26;
            this.words[i] = lo & 67108863;
          }
          if (carry !== 0) {
            this.words[i] = carry;
            this.length++;
          }
          return this;
        };
        BN.prototype.muln = function muln(num) {
          return this.clone().imuln(num);
        };
        BN.prototype.sqr = function sqr() {
          return this.mul(this);
        };
        BN.prototype.isqr = function isqr() {
          return this.imul(this.clone());
        };
        BN.prototype.pow = function pow(num) {
          var w = toBitArray(num);
          if (w.length === 0)
            return new BN(1);
          var res = this;
          for (var i = 0; i < w.length; i++, res = res.sqr()) {
            if (w[i] !== 0)
              break;
          }
          if (++i < w.length) {
            for (var q = res.sqr(); i < w.length; i++, q = q.sqr()) {
              if (w[i] === 0)
                continue;
              res = res.mul(q);
            }
          }
          return res;
        };
        BN.prototype.iushln = function iushln(bits) {
          assert2(typeof bits === "number" && bits >= 0);
          var r = bits % 26;
          var s = (bits - r) / 26;
          var carryMask = 67108863 >>> 26 - r << 26 - r;
          var i;
          if (r !== 0) {
            var carry = 0;
            for (i = 0; i < this.length; i++) {
              var newCarry = this.words[i] & carryMask;
              var c = (this.words[i] | 0) - newCarry << r;
              this.words[i] = c | carry;
              carry = newCarry >>> 26 - r;
            }
            if (carry) {
              this.words[i] = carry;
              this.length++;
            }
          }
          if (s !== 0) {
            for (i = this.length - 1; i >= 0; i--) {
              this.words[i + s] = this.words[i];
            }
            for (i = 0; i < s; i++) {
              this.words[i] = 0;
            }
            this.length += s;
          }
          return this.strip();
        };
        BN.prototype.ishln = function ishln(bits) {
          assert2(this.negative === 0);
          return this.iushln(bits);
        };
        BN.prototype.iushrn = function iushrn(bits, hint, extended) {
          assert2(typeof bits === "number" && bits >= 0);
          var h;
          if (hint) {
            h = (hint - hint % 26) / 26;
          } else {
            h = 0;
          }
          var r = bits % 26;
          var s = Math.min((bits - r) / 26, this.length);
          var mask = 67108863 ^ 67108863 >>> r << r;
          var maskedWords = extended;
          h -= s;
          h = Math.max(0, h);
          if (maskedWords) {
            for (var i = 0; i < s; i++) {
              maskedWords.words[i] = this.words[i];
            }
            maskedWords.length = s;
          }
          if (s === 0) {
          } else if (this.length > s) {
            this.length -= s;
            for (i = 0; i < this.length; i++) {
              this.words[i] = this.words[i + s];
            }
          } else {
            this.words[0] = 0;
            this.length = 1;
          }
          var carry = 0;
          for (i = this.length - 1; i >= 0 && (carry !== 0 || i >= h); i--) {
            var word = this.words[i] | 0;
            this.words[i] = carry << 26 - r | word >>> r;
            carry = word & mask;
          }
          if (maskedWords && carry !== 0) {
            maskedWords.words[maskedWords.length++] = carry;
          }
          if (this.length === 0) {
            this.words[0] = 0;
            this.length = 1;
          }
          return this.strip();
        };
        BN.prototype.ishrn = function ishrn(bits, hint, extended) {
          assert2(this.negative === 0);
          return this.iushrn(bits, hint, extended);
        };
        BN.prototype.shln = function shln(bits) {
          return this.clone().ishln(bits);
        };
        BN.prototype.ushln = function ushln(bits) {
          return this.clone().iushln(bits);
        };
        BN.prototype.shrn = function shrn(bits) {
          return this.clone().ishrn(bits);
        };
        BN.prototype.ushrn = function ushrn(bits) {
          return this.clone().iushrn(bits);
        };
        BN.prototype.testn = function testn(bit) {
          assert2(typeof bit === "number" && bit >= 0);
          var r = bit % 26;
          var s = (bit - r) / 26;
          var q = 1 << r;
          if (this.length <= s)
            return false;
          var w = this.words[s];
          return !!(w & q);
        };
        BN.prototype.imaskn = function imaskn(bits) {
          assert2(typeof bits === "number" && bits >= 0);
          var r = bits % 26;
          var s = (bits - r) / 26;
          assert2(this.negative === 0, "imaskn works only with positive numbers");
          if (this.length <= s) {
            return this;
          }
          if (r !== 0) {
            s++;
          }
          this.length = Math.min(s, this.length);
          if (r !== 0) {
            var mask = 67108863 ^ 67108863 >>> r << r;
            this.words[this.length - 1] &= mask;
          }
          return this.strip();
        };
        BN.prototype.maskn = function maskn(bits) {
          return this.clone().imaskn(bits);
        };
        BN.prototype.iaddn = function iaddn(num) {
          assert2(typeof num === "number");
          assert2(num < 67108864);
          if (num < 0)
            return this.isubn(-num);
          if (this.negative !== 0) {
            if (this.length === 1 && (this.words[0] | 0) < num) {
              this.words[0] = num - (this.words[0] | 0);
              this.negative = 0;
              return this;
            }
            this.negative = 0;
            this.isubn(num);
            this.negative = 1;
            return this;
          }
          return this._iaddn(num);
        };
        BN.prototype._iaddn = function _iaddn(num) {
          this.words[0] += num;
          for (var i = 0; i < this.length && this.words[i] >= 67108864; i++) {
            this.words[i] -= 67108864;
            if (i === this.length - 1) {
              this.words[i + 1] = 1;
            } else {
              this.words[i + 1]++;
            }
          }
          this.length = Math.max(this.length, i + 1);
          return this;
        };
        BN.prototype.isubn = function isubn(num) {
          assert2(typeof num === "number");
          assert2(num < 67108864);
          if (num < 0)
            return this.iaddn(-num);
          if (this.negative !== 0) {
            this.negative = 0;
            this.iaddn(num);
            this.negative = 1;
            return this;
          }
          this.words[0] -= num;
          if (this.length === 1 && this.words[0] < 0) {
            this.words[0] = -this.words[0];
            this.negative = 1;
          } else {
            for (var i = 0; i < this.length && this.words[i] < 0; i++) {
              this.words[i] += 67108864;
              this.words[i + 1] -= 1;
            }
          }
          return this.strip();
        };
        BN.prototype.addn = function addn(num) {
          return this.clone().iaddn(num);
        };
        BN.prototype.subn = function subn(num) {
          return this.clone().isubn(num);
        };
        BN.prototype.iabs = function iabs() {
          this.negative = 0;
          return this;
        };
        BN.prototype.abs = function abs() {
          return this.clone().iabs();
        };
        BN.prototype._ishlnsubmul = function _ishlnsubmul(num, mul, shift) {
          var len = num.length + shift;
          var i;
          this._expand(len);
          var w;
          var carry = 0;
          for (i = 0; i < num.length; i++) {
            w = (this.words[i + shift] | 0) + carry;
            var right = (num.words[i] | 0) * mul;
            w -= right & 67108863;
            carry = (w >> 26) - (right / 67108864 | 0);
            this.words[i + shift] = w & 67108863;
          }
          for (; i < this.length - shift; i++) {
            w = (this.words[i + shift] | 0) + carry;
            carry = w >> 26;
            this.words[i + shift] = w & 67108863;
          }
          if (carry === 0)
            return this.strip();
          assert2(carry === -1);
          carry = 0;
          for (i = 0; i < this.length; i++) {
            w = -(this.words[i] | 0) + carry;
            carry = w >> 26;
            this.words[i] = w & 67108863;
          }
          this.negative = 1;
          return this.strip();
        };
        BN.prototype._wordDiv = function _wordDiv(num, mode) {
          var shift = this.length - num.length;
          var a = this.clone();
          var b = num;
          var bhi = b.words[b.length - 1] | 0;
          var bhiBits = this._countBits(bhi);
          shift = 26 - bhiBits;
          if (shift !== 0) {
            b = b.ushln(shift);
            a.iushln(shift);
            bhi = b.words[b.length - 1] | 0;
          }
          var m = a.length - b.length;
          var q;
          if (mode !== "mod") {
            q = new BN(null);
            q.length = m + 1;
            q.words = new Array(q.length);
            for (var i = 0; i < q.length; i++) {
              q.words[i] = 0;
            }
          }
          var diff = a.clone()._ishlnsubmul(b, 1, m);
          if (diff.negative === 0) {
            a = diff;
            if (q) {
              q.words[m] = 1;
            }
          }
          for (var j = m - 1; j >= 0; j--) {
            var qj = (a.words[b.length + j] | 0) * 67108864 + (a.words[b.length + j - 1] | 0);
            qj = Math.min(qj / bhi | 0, 67108863);
            a._ishlnsubmul(b, qj, j);
            while (a.negative !== 0) {
              qj--;
              a.negative = 0;
              a._ishlnsubmul(b, 1, j);
              if (!a.isZero()) {
                a.negative ^= 1;
              }
            }
            if (q) {
              q.words[j] = qj;
            }
          }
          if (q) {
            q.strip();
          }
          a.strip();
          if (mode !== "div" && shift !== 0) {
            a.iushrn(shift);
          }
          return {
            div: q || null,
            mod: a
          };
        };
        BN.prototype.divmod = function divmod(num, mode, positive) {
          assert2(!num.isZero());
          if (this.isZero()) {
            return {
              div: new BN(0),
              mod: new BN(0)
            };
          }
          var div, mod, res;
          if (this.negative !== 0 && num.negative === 0) {
            res = this.neg().divmod(num, mode);
            if (mode !== "mod") {
              div = res.div.neg();
            }
            if (mode !== "div") {
              mod = res.mod.neg();
              if (positive && mod.negative !== 0) {
                mod.iadd(num);
              }
            }
            return {
              div,
              mod
            };
          }
          if (this.negative === 0 && num.negative !== 0) {
            res = this.divmod(num.neg(), mode);
            if (mode !== "mod") {
              div = res.div.neg();
            }
            return {
              div,
              mod: res.mod
            };
          }
          if ((this.negative & num.negative) !== 0) {
            res = this.neg().divmod(num.neg(), mode);
            if (mode !== "div") {
              mod = res.mod.neg();
              if (positive && mod.negative !== 0) {
                mod.isub(num);
              }
            }
            return {
              div: res.div,
              mod
            };
          }
          if (num.length > this.length || this.cmp(num) < 0) {
            return {
              div: new BN(0),
              mod: this
            };
          }
          if (num.length === 1) {
            if (mode === "div") {
              return {
                div: this.divn(num.words[0]),
                mod: null
              };
            }
            if (mode === "mod") {
              return {
                div: null,
                mod: new BN(this.modn(num.words[0]))
              };
            }
            return {
              div: this.divn(num.words[0]),
              mod: new BN(this.modn(num.words[0]))
            };
          }
          return this._wordDiv(num, mode);
        };
        BN.prototype.div = function div(num) {
          return this.divmod(num, "div", false).div;
        };
        BN.prototype.mod = function mod(num) {
          return this.divmod(num, "mod", false).mod;
        };
        BN.prototype.umod = function umod(num) {
          return this.divmod(num, "mod", true).mod;
        };
        BN.prototype.divRound = function divRound(num) {
          var dm = this.divmod(num);
          if (dm.mod.isZero())
            return dm.div;
          var mod = dm.div.negative !== 0 ? dm.mod.isub(num) : dm.mod;
          var half = num.ushrn(1);
          var r2 = num.andln(1);
          var cmp = mod.cmp(half);
          if (cmp < 0 || r2 === 1 && cmp === 0)
            return dm.div;
          return dm.div.negative !== 0 ? dm.div.isubn(1) : dm.div.iaddn(1);
        };
        BN.prototype.modn = function modn(num) {
          assert2(num <= 67108863);
          var p = (1 << 26) % num;
          var acc = 0;
          for (var i = this.length - 1; i >= 0; i--) {
            acc = (p * acc + (this.words[i] | 0)) % num;
          }
          return acc;
        };
        BN.prototype.idivn = function idivn(num) {
          assert2(num <= 67108863);
          var carry = 0;
          for (var i = this.length - 1; i >= 0; i--) {
            var w = (this.words[i] | 0) + carry * 67108864;
            this.words[i] = w / num | 0;
            carry = w % num;
          }
          return this.strip();
        };
        BN.prototype.divn = function divn(num) {
          return this.clone().idivn(num);
        };
        BN.prototype.egcd = function egcd(p) {
          assert2(p.negative === 0);
          assert2(!p.isZero());
          var x = this;
          var y = p.clone();
          if (x.negative !== 0) {
            x = x.umod(p);
          } else {
            x = x.clone();
          }
          var A = new BN(1);
          var B = new BN(0);
          var C = new BN(0);
          var D = new BN(1);
          var g = 0;
          while (x.isEven() && y.isEven()) {
            x.iushrn(1);
            y.iushrn(1);
            ++g;
          }
          var yp = y.clone();
          var xp = x.clone();
          while (!x.isZero()) {
            for (var i = 0, im = 1; (x.words[0] & im) === 0 && i < 26; ++i, im <<= 1)
              ;
            if (i > 0) {
              x.iushrn(i);
              while (i-- > 0) {
                if (A.isOdd() || B.isOdd()) {
                  A.iadd(yp);
                  B.isub(xp);
                }
                A.iushrn(1);
                B.iushrn(1);
              }
            }
            for (var j = 0, jm = 1; (y.words[0] & jm) === 0 && j < 26; ++j, jm <<= 1)
              ;
            if (j > 0) {
              y.iushrn(j);
              while (j-- > 0) {
                if (C.isOdd() || D.isOdd()) {
                  C.iadd(yp);
                  D.isub(xp);
                }
                C.iushrn(1);
                D.iushrn(1);
              }
            }
            if (x.cmp(y) >= 0) {
              x.isub(y);
              A.isub(C);
              B.isub(D);
            } else {
              y.isub(x);
              C.isub(A);
              D.isub(B);
            }
          }
          return {
            a: C,
            b: D,
            gcd: y.iushln(g)
          };
        };
        BN.prototype._invmp = function _invmp(p) {
          assert2(p.negative === 0);
          assert2(!p.isZero());
          var a = this;
          var b = p.clone();
          if (a.negative !== 0) {
            a = a.umod(p);
          } else {
            a = a.clone();
          }
          var x1 = new BN(1);
          var x2 = new BN(0);
          var delta = b.clone();
          while (a.cmpn(1) > 0 && b.cmpn(1) > 0) {
            for (var i = 0, im = 1; (a.words[0] & im) === 0 && i < 26; ++i, im <<= 1)
              ;
            if (i > 0) {
              a.iushrn(i);
              while (i-- > 0) {
                if (x1.isOdd()) {
                  x1.iadd(delta);
                }
                x1.iushrn(1);
              }
            }
            for (var j = 0, jm = 1; (b.words[0] & jm) === 0 && j < 26; ++j, jm <<= 1)
              ;
            if (j > 0) {
              b.iushrn(j);
              while (j-- > 0) {
                if (x2.isOdd()) {
                  x2.iadd(delta);
                }
                x2.iushrn(1);
              }
            }
            if (a.cmp(b) >= 0) {
              a.isub(b);
              x1.isub(x2);
            } else {
              b.isub(a);
              x2.isub(x1);
            }
          }
          var res;
          if (a.cmpn(1) === 0) {
            res = x1;
          } else {
            res = x2;
          }
          if (res.cmpn(0) < 0) {
            res.iadd(p);
          }
          return res;
        };
        BN.prototype.gcd = function gcd(num) {
          if (this.isZero())
            return num.abs();
          if (num.isZero())
            return this.abs();
          var a = this.clone();
          var b = num.clone();
          a.negative = 0;
          b.negative = 0;
          for (var shift = 0; a.isEven() && b.isEven(); shift++) {
            a.iushrn(1);
            b.iushrn(1);
          }
          do {
            while (a.isEven()) {
              a.iushrn(1);
            }
            while (b.isEven()) {
              b.iushrn(1);
            }
            var r = a.cmp(b);
            if (r < 0) {
              var t = a;
              a = b;
              b = t;
            } else if (r === 0 || b.cmpn(1) === 0) {
              break;
            }
            a.isub(b);
          } while (true);
          return b.iushln(shift);
        };
        BN.prototype.invm = function invm(num) {
          return this.egcd(num).a.umod(num);
        };
        BN.prototype.isEven = function isEven() {
          return (this.words[0] & 1) === 0;
        };
        BN.prototype.isOdd = function isOdd() {
          return (this.words[0] & 1) === 1;
        };
        BN.prototype.andln = function andln(num) {
          return this.words[0] & num;
        };
        BN.prototype.bincn = function bincn(bit) {
          assert2(typeof bit === "number");
          var r = bit % 26;
          var s = (bit - r) / 26;
          var q = 1 << r;
          if (this.length <= s) {
            this._expand(s + 1);
            this.words[s] |= q;
            return this;
          }
          var carry = q;
          for (var i = s; carry !== 0 && i < this.length; i++) {
            var w = this.words[i] | 0;
            w += carry;
            carry = w >>> 26;
            w &= 67108863;
            this.words[i] = w;
          }
          if (carry !== 0) {
            this.words[i] = carry;
            this.length++;
          }
          return this;
        };
        BN.prototype.isZero = function isZero() {
          return this.length === 1 && this.words[0] === 0;
        };
        BN.prototype.cmpn = function cmpn(num) {
          var negative = num < 0;
          if (this.negative !== 0 && !negative)
            return -1;
          if (this.negative === 0 && negative)
            return 1;
          this.strip();
          var res;
          if (this.length > 1) {
            res = 1;
          } else {
            if (negative) {
              num = -num;
            }
            assert2(num <= 67108863, "Number is too big");
            var w = this.words[0] | 0;
            res = w === num ? 0 : w < num ? -1 : 1;
          }
          if (this.negative !== 0)
            return -res | 0;
          return res;
        };
        BN.prototype.cmp = function cmp(num) {
          if (this.negative !== 0 && num.negative === 0)
            return -1;
          if (this.negative === 0 && num.negative !== 0)
            return 1;
          var res = this.ucmp(num);
          if (this.negative !== 0)
            return -res | 0;
          return res;
        };
        BN.prototype.ucmp = function ucmp(num) {
          if (this.length > num.length)
            return 1;
          if (this.length < num.length)
            return -1;
          var res = 0;
          for (var i = this.length - 1; i >= 0; i--) {
            var a = this.words[i] | 0;
            var b = num.words[i] | 0;
            if (a === b)
              continue;
            if (a < b) {
              res = -1;
            } else if (a > b) {
              res = 1;
            }
            break;
          }
          return res;
        };
        BN.prototype.gtn = function gtn(num) {
          return this.cmpn(num) === 1;
        };
        BN.prototype.gt = function gt(num) {
          return this.cmp(num) === 1;
        };
        BN.prototype.gten = function gten(num) {
          return this.cmpn(num) >= 0;
        };
        BN.prototype.gte = function gte(num) {
          return this.cmp(num) >= 0;
        };
        BN.prototype.ltn = function ltn(num) {
          return this.cmpn(num) === -1;
        };
        BN.prototype.lt = function lt(num) {
          return this.cmp(num) === -1;
        };
        BN.prototype.lten = function lten(num) {
          return this.cmpn(num) <= 0;
        };
        BN.prototype.lte = function lte(num) {
          return this.cmp(num) <= 0;
        };
        BN.prototype.eqn = function eqn(num) {
          return this.cmpn(num) === 0;
        };
        BN.prototype.eq = function eq(num) {
          return this.cmp(num) === 0;
        };
        BN.red = function red(num) {
          return new Red(num);
        };
        BN.prototype.toRed = function toRed(ctx) {
          assert2(!this.red, "Already a number in reduction context");
          assert2(this.negative === 0, "red works only with positives");
          return ctx.convertTo(this)._forceRed(ctx);
        };
        BN.prototype.fromRed = function fromRed() {
          assert2(this.red, "fromRed works only with numbers in reduction context");
          return this.red.convertFrom(this);
        };
        BN.prototype._forceRed = function _forceRed(ctx) {
          this.red = ctx;
          return this;
        };
        BN.prototype.forceRed = function forceRed(ctx) {
          assert2(!this.red, "Already a number in reduction context");
          return this._forceRed(ctx);
        };
        BN.prototype.redAdd = function redAdd(num) {
          assert2(this.red, "redAdd works only with red numbers");
          return this.red.add(this, num);
        };
        BN.prototype.redIAdd = function redIAdd(num) {
          assert2(this.red, "redIAdd works only with red numbers");
          return this.red.iadd(this, num);
        };
        BN.prototype.redSub = function redSub(num) {
          assert2(this.red, "redSub works only with red numbers");
          return this.red.sub(this, num);
        };
        BN.prototype.redISub = function redISub(num) {
          assert2(this.red, "redISub works only with red numbers");
          return this.red.isub(this, num);
        };
        BN.prototype.redShl = function redShl(num) {
          assert2(this.red, "redShl works only with red numbers");
          return this.red.shl(this, num);
        };
        BN.prototype.redMul = function redMul(num) {
          assert2(this.red, "redMul works only with red numbers");
          this.red._verify2(this, num);
          return this.red.mul(this, num);
        };
        BN.prototype.redIMul = function redIMul(num) {
          assert2(this.red, "redMul works only with red numbers");
          this.red._verify2(this, num);
          return this.red.imul(this, num);
        };
        BN.prototype.redSqr = function redSqr() {
          assert2(this.red, "redSqr works only with red numbers");
          this.red._verify1(this);
          return this.red.sqr(this);
        };
        BN.prototype.redISqr = function redISqr() {
          assert2(this.red, "redISqr works only with red numbers");
          this.red._verify1(this);
          return this.red.isqr(this);
        };
        BN.prototype.redSqrt = function redSqrt() {
          assert2(this.red, "redSqrt works only with red numbers");
          this.red._verify1(this);
          return this.red.sqrt(this);
        };
        BN.prototype.redInvm = function redInvm() {
          assert2(this.red, "redInvm works only with red numbers");
          this.red._verify1(this);
          return this.red.invm(this);
        };
        BN.prototype.redNeg = function redNeg() {
          assert2(this.red, "redNeg works only with red numbers");
          this.red._verify1(this);
          return this.red.neg(this);
        };
        BN.prototype.redPow = function redPow(num) {
          assert2(this.red && !num.red, "redPow(normalNum)");
          this.red._verify1(this);
          return this.red.pow(this, num);
        };
        var primes = {
          k256: null,
          p224: null,
          p192: null,
          p25519: null
        };
        function MPrime(name4, p) {
          this.name = name4;
          this.p = new BN(p, 16);
          this.n = this.p.bitLength();
          this.k = new BN(1).iushln(this.n).isub(this.p);
          this.tmp = this._tmp();
        }
        MPrime.prototype._tmp = function _tmp() {
          var tmp = new BN(null);
          tmp.words = new Array(Math.ceil(this.n / 13));
          return tmp;
        };
        MPrime.prototype.ireduce = function ireduce(num) {
          var r = num;
          var rlen;
          do {
            this.split(r, this.tmp);
            r = this.imulK(r);
            r = r.iadd(this.tmp);
            rlen = r.bitLength();
          } while (rlen > this.n);
          var cmp = rlen < this.n ? -1 : r.ucmp(this.p);
          if (cmp === 0) {
            r.words[0] = 0;
            r.length = 1;
          } else if (cmp > 0) {
            r.isub(this.p);
          } else {
            if (r.strip !== void 0) {
              r.strip();
            } else {
              r._strip();
            }
          }
          return r;
        };
        MPrime.prototype.split = function split3(input, out) {
          input.iushrn(this.n, 0, out);
        };
        MPrime.prototype.imulK = function imulK(num) {
          return num.imul(this.k);
        };
        function K256() {
          MPrime.call(
              this,
              "k256",
              "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe fffffc2f"
          );
        }
        inherits(K256, MPrime);
        K256.prototype.split = function split3(input, output2) {
          var mask = 4194303;
          var outLen = Math.min(input.length, 9);
          for (var i = 0; i < outLen; i++) {
            output2.words[i] = input.words[i];
          }
          output2.length = outLen;
          if (input.length <= 9) {
            input.words[0] = 0;
            input.length = 1;
            return;
          }
          var prev = input.words[9];
          output2.words[output2.length++] = prev & mask;
          for (i = 10; i < input.length; i++) {
            var next = input.words[i] | 0;
            input.words[i - 10] = (next & mask) << 4 | prev >>> 22;
            prev = next;
          }
          prev >>>= 22;
          input.words[i - 10] = prev;
          if (prev === 0 && input.length > 10) {
            input.length -= 10;
          } else {
            input.length -= 9;
          }
        };
        K256.prototype.imulK = function imulK(num) {
          num.words[num.length] = 0;
          num.words[num.length + 1] = 0;
          num.length += 2;
          var lo = 0;
          for (var i = 0; i < num.length; i++) {
            var w = num.words[i] | 0;
            lo += w * 977;
            num.words[i] = lo & 67108863;
            lo = w * 64 + (lo / 67108864 | 0);
          }
          if (num.words[num.length - 1] === 0) {
            num.length--;
            if (num.words[num.length - 1] === 0) {
              num.length--;
            }
          }
          return num;
        };
        function P224() {
          MPrime.call(
              this,
              "p224",
              "ffffffff ffffffff ffffffff ffffffff 00000000 00000000 00000001"
          );
        }
        inherits(P224, MPrime);
        function P192() {
          MPrime.call(
              this,
              "p192",
              "ffffffff ffffffff ffffffff fffffffe ffffffff ffffffff"
          );
        }
        inherits(P192, MPrime);
        function P25519() {
          MPrime.call(
              this,
              "25519",
              "7fffffffffffffff ffffffffffffffff ffffffffffffffff ffffffffffffffed"
          );
        }
        inherits(P25519, MPrime);
        P25519.prototype.imulK = function imulK(num) {
          var carry = 0;
          for (var i = 0; i < num.length; i++) {
            var hi = (num.words[i] | 0) * 19 + carry;
            var lo = hi & 67108863;
            hi >>>= 26;
            num.words[i] = lo;
            carry = hi;
          }
          if (carry !== 0) {
            num.words[num.length++] = carry;
          }
          return num;
        };
        BN._prime = function prime(name4) {
          if (primes[name4])
            return primes[name4];
          var prime2;
          if (name4 === "k256") {
            prime2 = new K256();
          } else if (name4 === "p224") {
            prime2 = new P224();
          } else if (name4 === "p192") {
            prime2 = new P192();
          } else if (name4 === "p25519") {
            prime2 = new P25519();
          } else {
            throw new Error("Unknown prime " + name4);
          }
          primes[name4] = prime2;
          return prime2;
        };
        function Red(m) {
          if (typeof m === "string") {
            var prime = BN._prime(m);
            this.m = prime.p;
            this.prime = prime;
          } else {
            assert2(m.gtn(1), "modulus must be greater than 1");
            this.m = m;
            this.prime = null;
          }
        }
        Red.prototype._verify1 = function _verify1(a) {
          assert2(a.negative === 0, "red works only with positives");
          assert2(a.red, "red works only with red numbers");
        };
        Red.prototype._verify2 = function _verify2(a, b) {
          assert2((a.negative | b.negative) === 0, "red works only with positives");
          assert2(
              a.red && a.red === b.red,
              "red works only with red numbers"
          );
        };
        Red.prototype.imod = function imod(a) {
          if (this.prime)
            return this.prime.ireduce(a)._forceRed(this);
          return a.umod(this.m)._forceRed(this);
        };
        Red.prototype.neg = function neg(a) {
          if (a.isZero()) {
            return a.clone();
          }
          return this.m.sub(a)._forceRed(this);
        };
        Red.prototype.add = function add2(a, b) {
          this._verify2(a, b);
          var res = a.add(b);
          if (res.cmp(this.m) >= 0) {
            res.isub(this.m);
          }
          return res._forceRed(this);
        };
        Red.prototype.iadd = function iadd(a, b) {
          this._verify2(a, b);
          var res = a.iadd(b);
          if (res.cmp(this.m) >= 0) {
            res.isub(this.m);
          }
          return res;
        };
        Red.prototype.sub = function sub(a, b) {
          this._verify2(a, b);
          var res = a.sub(b);
          if (res.cmpn(0) < 0) {
            res.iadd(this.m);
          }
          return res._forceRed(this);
        };
        Red.prototype.isub = function isub(a, b) {
          this._verify2(a, b);
          var res = a.isub(b);
          if (res.cmpn(0) < 0) {
            res.iadd(this.m);
          }
          return res;
        };
        Red.prototype.shl = function shl(a, num) {
          this._verify1(a);
          return this.imod(a.ushln(num));
        };
        Red.prototype.imul = function imul(a, b) {
          this._verify2(a, b);
          return this.imod(a.imul(b));
        };
        Red.prototype.mul = function mul(a, b) {
          this._verify2(a, b);
          return this.imod(a.mul(b));
        };
        Red.prototype.isqr = function isqr(a) {
          return this.imul(a, a.clone());
        };
        Red.prototype.sqr = function sqr(a) {
          return this.mul(a, a);
        };
        Red.prototype.sqrt = function sqrt(a) {
          if (a.isZero())
            return a.clone();
          var mod3 = this.m.andln(3);
          assert2(mod3 % 2 === 1);
          if (mod3 === 3) {
            var pow = this.m.add(new BN(1)).iushrn(2);
            return this.pow(a, pow);
          }
          var q = this.m.subn(1);
          var s = 0;
          while (!q.isZero() && q.andln(1) === 0) {
            s++;
            q.iushrn(1);
          }
          assert2(!q.isZero());
          var one = new BN(1).toRed(this);
          var nOne = one.redNeg();
          var lpow = this.m.subn(1).iushrn(1);
          var z = this.m.bitLength();
          z = new BN(2 * z * z).toRed(this);
          while (this.pow(z, lpow).cmp(nOne) !== 0) {
            z.redIAdd(nOne);
          }
          var c = this.pow(z, q);
          var r = this.pow(a, q.addn(1).iushrn(1));
          var t = this.pow(a, q);
          var m = s;
          while (t.cmp(one) !== 0) {
            var tmp = t;
            for (var i = 0; tmp.cmp(one) !== 0; i++) {
              tmp = tmp.redSqr();
            }
            assert2(i < m);
            var b = this.pow(c, new BN(1).iushln(m - i - 1));
            r = r.redMul(b);
            c = b.redSqr();
            t = t.redMul(c);
            m = i;
          }
          return r;
        };
        Red.prototype.invm = function invm(a) {
          var inv = a._invmp(this.m);
          if (inv.negative !== 0) {
            inv.negative = 0;
            return this.imod(inv).redNeg();
          } else {
            return this.imod(inv);
          }
        };
        Red.prototype.pow = function pow(a, num) {
          if (num.isZero())
            return new BN(1).toRed(this);
          if (num.cmpn(1) === 0)
            return a.clone();
          var windowSize = 4;
          var wnd = new Array(1 << windowSize);
          wnd[0] = new BN(1).toRed(this);
          wnd[1] = a;
          for (var i = 2; i < wnd.length; i++) {
            wnd[i] = this.mul(wnd[i - 1], a);
          }
          var res = wnd[0];
          var current = 0;
          var currentLen = 0;
          var start = num.bitLength() % 26;
          if (start === 0) {
            start = 26;
          }
          for (i = num.length - 1; i >= 0; i--) {
            var word = num.words[i];
            for (var j = start - 1; j >= 0; j--) {
              var bit = word >> j & 1;
              if (res !== wnd[0]) {
                res = this.sqr(res);
              }
              if (bit === 0 && current === 0) {
                currentLen = 0;
                continue;
              }
              current <<= 1;
              current |= bit;
              currentLen++;
              if (currentLen !== windowSize && (i !== 0 || j !== 0))
                continue;
              res = this.mul(res, wnd[current]);
              currentLen = 0;
              current = 0;
            }
            start = 26;
          }
          return res;
        };
        Red.prototype.convertTo = function convertTo(num) {
          var r = num.umod(this.m);
          return r === num ? r.clone() : r;
        };
        Red.prototype.convertFrom = function convertFrom(num) {
          var res = num.clone();
          res.red = null;
          return res;
        };
        BN.mont = function mont(num) {
          return new Mont(num);
        };
        function Mont(m) {
          Red.call(this, m);
          this.shift = this.m.bitLength();
          if (this.shift % 26 !== 0) {
            this.shift += 26 - this.shift % 26;
          }
          this.r = new BN(1).iushln(this.shift);
          this.r2 = this.imod(this.r.sqr());
          this.rinv = this.r._invmp(this.m);
          this.minv = this.rinv.mul(this.r).isubn(1).div(this.m);
          this.minv = this.minv.umod(this.r);
          this.minv = this.r.sub(this.minv);
        }
        inherits(Mont, Red);
        Mont.prototype.convertTo = function convertTo(num) {
          return this.imod(num.ushln(this.shift));
        };
        Mont.prototype.convertFrom = function convertFrom(num) {
          var r = this.imod(num.mul(this.rinv));
          r.red = null;
          return r;
        };
        Mont.prototype.imul = function imul(a, b) {
          if (a.isZero() || b.isZero()) {
            a.words[0] = 0;
            a.length = 1;
            return a;
          }
          var t = a.imul(b);
          var c = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
          var u = t.isub(c).iushrn(this.shift);
          var res = u;
          if (u.cmp(this.m) >= 0) {
            res = u.isub(this.m);
          } else if (u.cmpn(0) < 0) {
            res = u.iadd(this.m);
          }
          return res._forceRed(this);
        };
        Mont.prototype.mul = function mul(a, b) {
          if (a.isZero() || b.isZero())
            return new BN(0)._forceRed(this);
          var t = a.mul(b);
          var c = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
          var u = t.isub(c).iushrn(this.shift);
          var res = u;
          if (u.cmp(this.m) >= 0) {
            res = u.isub(this.m);
          } else if (u.cmpn(0) < 0) {
            res = u.iadd(this.m);
          }
          return res._forceRed(this);
        };
        Mont.prototype.invm = function invm(a) {
          var res = this.imod(a._invmp(this.m).mul(this.r2));
          return res._forceRed(this);
        };
      })(typeof module === "undefined" || module, exports);
    }
  });

  // node_modules/minimalistic-assert/index.js
  var require_minimalistic_assert = __commonJS({
    "node_modules/minimalistic-assert/index.js"(exports, module) {
      module.exports = assert2;
      function assert2(val, msg) {
        if (!val)
          throw new Error(msg || "Assertion failed");
      }
      assert2.equal = function assertEqual(l, r, msg) {
        if (l != r)
          throw new Error(msg || "Assertion failed: " + l + " != " + r);
      };
    }
  });

  // node_modules/minimalistic-crypto-utils/lib/utils.js
  var require_utils = __commonJS({
    "node_modules/minimalistic-crypto-utils/lib/utils.js"(exports) {
      "use strict";
      var utils = exports;
      function toArray2(msg, enc) {
        if (Array.isArray(msg))
          return msg.slice();
        if (!msg)
          return [];
        var res = [];
        if (typeof msg !== "string") {
          for (var i = 0; i < msg.length; i++)
            res[i] = msg[i] | 0;
          return res;
        }
        if (enc === "hex") {
          msg = msg.replace(/[^a-z0-9]+/ig, "");
          if (msg.length % 2 !== 0)
            msg = "0" + msg;
          for (var i = 0; i < msg.length; i += 2)
            res.push(parseInt(msg[i] + msg[i + 1], 16));
        } else {
          for (var i = 0; i < msg.length; i++) {
            var c = msg.charCodeAt(i);
            var hi = c >> 8;
            var lo = c & 255;
            if (hi)
              res.push(hi, lo);
            else
              res.push(lo);
          }
        }
        return res;
      }
      utils.toArray = toArray2;
      function zero2(word) {
        if (word.length === 1)
          return "0" + word;
        else
          return word;
      }
      utils.zero2 = zero2;
      function toHex(msg) {
        var res = "";
        for (var i = 0; i < msg.length; i++)
          res += zero2(msg[i].toString(16));
        return res;
      }
      utils.toHex = toHex;
      utils.encode = function encode14(arr, enc) {
        if (enc === "hex")
          return toHex(arr);
        else
          return arr;
      };
    }
  });

  // node_modules/elliptic/lib/elliptic/utils.js
  var require_utils2 = __commonJS({
    "node_modules/elliptic/lib/elliptic/utils.js"(exports) {
      "use strict";
      var utils = exports;
      var BN = require_bn();
      var minAssert = require_minimalistic_assert();
      var minUtils = require_utils();
      utils.assert = minAssert;
      utils.toArray = minUtils.toArray;
      utils.zero2 = minUtils.zero2;
      utils.toHex = minUtils.toHex;
      utils.encode = minUtils.encode;
      function getNAF(num, w, bits) {
        var naf = new Array(Math.max(num.bitLength(), bits) + 1);
        naf.fill(0);
        var ws = 1 << w + 1;
        var k = num.clone();
        for (var i = 0; i < naf.length; i++) {
          var z;
          var mod = k.andln(ws - 1);
          if (k.isOdd()) {
            if (mod > (ws >> 1) - 1)
              z = (ws >> 1) - mod;
            else
              z = mod;
            k.isubn(z);
          } else {
            z = 0;
          }
          naf[i] = z;
          k.iushrn(1);
        }
        return naf;
      }
      utils.getNAF = getNAF;
      function getJSF(k1, k2) {
        var jsf = [
          [],
          []
        ];
        k1 = k1.clone();
        k2 = k2.clone();
        var d1 = 0;
        var d2 = 0;
        var m8;
        while (k1.cmpn(-d1) > 0 || k2.cmpn(-d2) > 0) {
          var m14 = k1.andln(3) + d1 & 3;
          var m24 = k2.andln(3) + d2 & 3;
          if (m14 === 3)
            m14 = -1;
          if (m24 === 3)
            m24 = -1;
          var u1;
          if ((m14 & 1) === 0) {
            u1 = 0;
          } else {
            m8 = k1.andln(7) + d1 & 7;
            if ((m8 === 3 || m8 === 5) && m24 === 2)
              u1 = -m14;
            else
              u1 = m14;
          }
          jsf[0].push(u1);
          var u2;
          if ((m24 & 1) === 0) {
            u2 = 0;
          } else {
            m8 = k2.andln(7) + d2 & 7;
            if ((m8 === 3 || m8 === 5) && m14 === 2)
              u2 = -m24;
            else
              u2 = m24;
          }
          jsf[1].push(u2);
          if (2 * d1 === u1 + 1)
            d1 = 1 - d1;
          if (2 * d2 === u2 + 1)
            d2 = 1 - d2;
          k1.iushrn(1);
          k2.iushrn(1);
        }
        return jsf;
      }
      utils.getJSF = getJSF;
      function cachedProperty(obj, name4, computer) {
        var key = "_" + name4;
        obj.prototype[name4] = function cachedProperty2() {
          return this[key] !== void 0 ? this[key] : this[key] = computer.call(this);
        };
      }
      utils.cachedProperty = cachedProperty;
      function parseBytes(bytes2) {
        return typeof bytes2 === "string" ? utils.toArray(bytes2, "hex") : bytes2;
      }
      utils.parseBytes = parseBytes;
      function intFromLE(bytes2) {
        return new BN(bytes2, "hex", "le");
      }
      utils.intFromLE = intFromLE;
    }
  });

  // (disabled):crypto
  var require_crypto = __commonJS({
    "(disabled):crypto"() {
    }
  });

  // node_modules/brorand/index.js
  var require_brorand = __commonJS({
    "node_modules/brorand/index.js"(exports, module) {
      var r;
      module.exports = function rand(len) {
        if (!r)
          r = new Rand(null);
        return r.generate(len);
      };
      function Rand(rand) {
        this.rand = rand;
      }
      module.exports.Rand = Rand;
      Rand.prototype.generate = function generate(len) {
        return this._rand(len);
      };
      Rand.prototype._rand = function _rand(n) {
        if (this.rand.getBytes)
          return this.rand.getBytes(n);
        var res = new Uint8Array(n);
        for (var i = 0; i < res.length; i++)
          res[i] = this.rand.getByte();
        return res;
      };
      if (typeof self === "object") {
        if (self.crypto && self.crypto.getRandomValues) {
          Rand.prototype._rand = function _rand(n) {
            var arr = new Uint8Array(n);
            self.crypto.getRandomValues(arr);
            return arr;
          };
        } else if (self.msCrypto && self.msCrypto.getRandomValues) {
          Rand.prototype._rand = function _rand(n) {
            var arr = new Uint8Array(n);
            self.msCrypto.getRandomValues(arr);
            return arr;
          };
        } else if (typeof window === "object") {
          Rand.prototype._rand = function() {
            throw new Error("Not implemented yet");
          };
        }
      } else {
        try {
          crypto3 = require_crypto();
          if (typeof crypto3.randomBytes !== "function")
            throw new Error("Not supported");
          Rand.prototype._rand = function _rand(n) {
            return crypto3.randomBytes(n);
          };
        } catch (e) {
        }
      }
      var crypto3;
    }
  });

  // node_modules/elliptic/lib/elliptic/curve/base.js
  var require_base = __commonJS({
    "node_modules/elliptic/lib/elliptic/curve/base.js"(exports, module) {
      "use strict";
      var BN = require_bn();
      var utils = require_utils2();
      var getNAF = utils.getNAF;
      var getJSF = utils.getJSF;
      var assert2 = utils.assert;
      function BaseCurve(type, conf) {
        this.type = type;
        this.p = new BN(conf.p, 16);
        this.red = conf.prime ? BN.red(conf.prime) : BN.mont(this.p);
        this.zero = new BN(0).toRed(this.red);
        this.one = new BN(1).toRed(this.red);
        this.two = new BN(2).toRed(this.red);
        this.n = conf.n && new BN(conf.n, 16);
        this.g = conf.g && this.pointFromJSON(conf.g, conf.gRed);
        this._wnafT1 = new Array(4);
        this._wnafT2 = new Array(4);
        this._wnafT3 = new Array(4);
        this._wnafT4 = new Array(4);
        this._bitLength = this.n ? this.n.bitLength() : 0;
        var adjustCount = this.n && this.p.div(this.n);
        if (!adjustCount || adjustCount.cmpn(100) > 0) {
          this.redN = null;
        } else {
          this._maxwellTrick = true;
          this.redN = this.n.toRed(this.red);
        }
      }
      module.exports = BaseCurve;
      BaseCurve.prototype.point = function point() {
        throw new Error("Not implemented");
      };
      BaseCurve.prototype.validate = function validate() {
        throw new Error("Not implemented");
      };
      BaseCurve.prototype._fixedNafMul = function _fixedNafMul(p, k) {
        assert2(p.precomputed);
        var doubles = p._getDoubles();
        var naf = getNAF(k, 1, this._bitLength);
        var I = (1 << doubles.step + 1) - (doubles.step % 2 === 0 ? 2 : 1);
        I /= 3;
        var repr = [];
        var j;
        var nafW;
        for (j = 0; j < naf.length; j += doubles.step) {
          nafW = 0;
          for (var l = j + doubles.step - 1; l >= j; l--)
            nafW = (nafW << 1) + naf[l];
          repr.push(nafW);
        }
        var a = this.jpoint(null, null, null);
        var b = this.jpoint(null, null, null);
        for (var i = I; i > 0; i--) {
          for (j = 0; j < repr.length; j++) {
            nafW = repr[j];
            if (nafW === i)
              b = b.mixedAdd(doubles.points[j]);
            else if (nafW === -i)
              b = b.mixedAdd(doubles.points[j].neg());
          }
          a = a.add(b);
        }
        return a.toP();
      };
      BaseCurve.prototype._wnafMul = function _wnafMul(p, k) {
        var w = 4;
        var nafPoints = p._getNAFPoints(w);
        w = nafPoints.wnd;
        var wnd = nafPoints.points;
        var naf = getNAF(k, w, this._bitLength);
        var acc = this.jpoint(null, null, null);
        for (var i = naf.length - 1; i >= 0; i--) {
          for (var l = 0; i >= 0 && naf[i] === 0; i--)
            l++;
          if (i >= 0)
            l++;
          acc = acc.dblp(l);
          if (i < 0)
            break;
          var z = naf[i];
          assert2(z !== 0);
          if (p.type === "affine") {
            if (z > 0)
              acc = acc.mixedAdd(wnd[z - 1 >> 1]);
            else
              acc = acc.mixedAdd(wnd[-z - 1 >> 1].neg());
          } else {
            if (z > 0)
              acc = acc.add(wnd[z - 1 >> 1]);
            else
              acc = acc.add(wnd[-z - 1 >> 1].neg());
          }
        }
        return p.type === "affine" ? acc.toP() : acc;
      };
      BaseCurve.prototype._wnafMulAdd = function _wnafMulAdd(defW, points, coeffs, len, jacobianResult) {
        var wndWidth = this._wnafT1;
        var wnd = this._wnafT2;
        var naf = this._wnafT3;
        var max = 0;
        var i;
        var j;
        var p;
        for (i = 0; i < len; i++) {
          p = points[i];
          var nafPoints = p._getNAFPoints(defW);
          wndWidth[i] = nafPoints.wnd;
          wnd[i] = nafPoints.points;
        }
        for (i = len - 1; i >= 1; i -= 2) {
          var a = i - 1;
          var b = i;
          if (wndWidth[a] !== 1 || wndWidth[b] !== 1) {
            naf[a] = getNAF(coeffs[a], wndWidth[a], this._bitLength);
            naf[b] = getNAF(coeffs[b], wndWidth[b], this._bitLength);
            max = Math.max(naf[a].length, max);
            max = Math.max(naf[b].length, max);
            continue;
          }
          var comb = [
            points[a],
            /* 1 */
            null,
            /* 3 */
            null,
            /* 5 */
            points[b]
            /* 7 */
          ];
          if (points[a].y.cmp(points[b].y) === 0) {
            comb[1] = points[a].add(points[b]);
            comb[2] = points[a].toJ().mixedAdd(points[b].neg());
          } else if (points[a].y.cmp(points[b].y.redNeg()) === 0) {
            comb[1] = points[a].toJ().mixedAdd(points[b]);
            comb[2] = points[a].add(points[b].neg());
          } else {
            comb[1] = points[a].toJ().mixedAdd(points[b]);
            comb[2] = points[a].toJ().mixedAdd(points[b].neg());
          }
          var index = [
            -3,
            /* -1 -1 */
            -1,
            /* -1 0 */
            -5,
            /* -1 1 */
            -7,
            /* 0 -1 */
            0,
            /* 0 0 */
            7,
            /* 0 1 */
            5,
            /* 1 -1 */
            1,
            /* 1 0 */
            3
            /* 1 1 */
          ];
          var jsf = getJSF(coeffs[a], coeffs[b]);
          max = Math.max(jsf[0].length, max);
          naf[a] = new Array(max);
          naf[b] = new Array(max);
          for (j = 0; j < max; j++) {
            var ja = jsf[0][j] | 0;
            var jb = jsf[1][j] | 0;
            naf[a][j] = index[(ja + 1) * 3 + (jb + 1)];
            naf[b][j] = 0;
            wnd[a] = comb;
          }
        }
        var acc = this.jpoint(null, null, null);
        var tmp = this._wnafT4;
        for (i = max; i >= 0; i--) {
          var k = 0;
          while (i >= 0) {
            var zero = true;
            for (j = 0; j < len; j++) {
              tmp[j] = naf[j][i] | 0;
              if (tmp[j] !== 0)
                zero = false;
            }
            if (!zero)
              break;
            k++;
            i--;
          }
          if (i >= 0)
            k++;
          acc = acc.dblp(k);
          if (i < 0)
            break;
          for (j = 0; j < len; j++) {
            var z = tmp[j];
            p;
            if (z === 0)
              continue;
            else if (z > 0)
              p = wnd[j][z - 1 >> 1];
            else if (z < 0)
              p = wnd[j][-z - 1 >> 1].neg();
            if (p.type === "affine")
              acc = acc.mixedAdd(p);
            else
              acc = acc.add(p);
          }
        }
        for (i = 0; i < len; i++)
          wnd[i] = null;
        if (jacobianResult)
          return acc;
        else
          return acc.toP();
      };
      function BasePoint(curve, type) {
        this.curve = curve;
        this.type = type;
        this.precomputed = null;
      }
      BaseCurve.BasePoint = BasePoint;
      BasePoint.prototype.eq = function eq() {
        throw new Error("Not implemented");
      };
      BasePoint.prototype.validate = function validate() {
        return this.curve.validate(this);
      };
      BaseCurve.prototype.decodePoint = function decodePoint(bytes2, enc) {
        bytes2 = utils.toArray(bytes2, enc);
        var len = this.p.byteLength();
        if ((bytes2[0] === 4 || bytes2[0] === 6 || bytes2[0] === 7) && bytes2.length - 1 === 2 * len) {
          if (bytes2[0] === 6)
            assert2(bytes2[bytes2.length - 1] % 2 === 0);
          else if (bytes2[0] === 7)
            assert2(bytes2[bytes2.length - 1] % 2 === 1);
          var res = this.point(
              bytes2.slice(1, 1 + len),
              bytes2.slice(1 + len, 1 + 2 * len)
          );
          return res;
        } else if ((bytes2[0] === 2 || bytes2[0] === 3) && bytes2.length - 1 === len) {
          return this.pointFromX(bytes2.slice(1, 1 + len), bytes2[0] === 3);
        }
        throw new Error("Unknown point format");
      };
      BasePoint.prototype.encodeCompressed = function encodeCompressed(enc) {
        return this.encode(enc, true);
      };
      BasePoint.prototype._encode = function _encode(compact) {
        var len = this.curve.p.byteLength();
        var x = this.getX().toArray("be", len);
        if (compact)
          return [this.getY().isEven() ? 2 : 3].concat(x);
        return [4].concat(x, this.getY().toArray("be", len));
      };
      BasePoint.prototype.encode = function encode14(enc, compact) {
        return utils.encode(this._encode(compact), enc);
      };
      BasePoint.prototype.precompute = function precompute(power) {
        if (this.precomputed)
          return this;
        var precomputed = {
          doubles: null,
          naf: null,
          beta: null
        };
        precomputed.naf = this._getNAFPoints(8);
        precomputed.doubles = this._getDoubles(4, power);
        precomputed.beta = this._getBeta();
        this.precomputed = precomputed;
        return this;
      };
      BasePoint.prototype._hasDoubles = function _hasDoubles(k) {
        if (!this.precomputed)
          return false;
        var doubles = this.precomputed.doubles;
        if (!doubles)
          return false;
        return doubles.points.length >= Math.ceil((k.bitLength() + 1) / doubles.step);
      };
      BasePoint.prototype._getDoubles = function _getDoubles(step, power) {
        if (this.precomputed && this.precomputed.doubles)
          return this.precomputed.doubles;
        var doubles = [this];
        var acc = this;
        for (var i = 0; i < power; i += step) {
          for (var j = 0; j < step; j++)
            acc = acc.dbl();
          doubles.push(acc);
        }
        return {
          step,
          points: doubles
        };
      };
      BasePoint.prototype._getNAFPoints = function _getNAFPoints(wnd) {
        if (this.precomputed && this.precomputed.naf)
          return this.precomputed.naf;
        var res = [this];
        var max = (1 << wnd) - 1;
        var dbl = max === 1 ? null : this.dbl();
        for (var i = 1; i < max; i++)
          res[i] = res[i - 1].add(dbl);
        return {
          wnd,
          points: res
        };
      };
      BasePoint.prototype._getBeta = function _getBeta() {
        return null;
      };
      BasePoint.prototype.dblp = function dblp(k) {
        var r = this;
        for (var i = 0; i < k; i++)
          r = r.dbl();
        return r;
      };
    }
  });

  // node_modules/inherits/inherits_browser.js
  var require_inherits_browser = __commonJS({
    "node_modules/inherits/inherits_browser.js"(exports, module) {
      if (typeof Object.create === "function") {
        module.exports = function inherits(ctor, superCtor) {
          if (superCtor) {
            ctor.super_ = superCtor;
            ctor.prototype = Object.create(superCtor.prototype, {
              constructor: {
                value: ctor,
                enumerable: false,
                writable: true,
                configurable: true
              }
            });
          }
        };
      } else {
        module.exports = function inherits(ctor, superCtor) {
          if (superCtor) {
            ctor.super_ = superCtor;
            var TempCtor = function() {
            };
            TempCtor.prototype = superCtor.prototype;
            ctor.prototype = new TempCtor();
            ctor.prototype.constructor = ctor;
          }
        };
      }
    }
  });

  // node_modules/elliptic/lib/elliptic/curve/short.js
  var require_short = __commonJS({
    "node_modules/elliptic/lib/elliptic/curve/short.js"(exports, module) {
      "use strict";
      var utils = require_utils2();
      var BN = require_bn();
      var inherits = require_inherits_browser();
      var Base = require_base();
      var assert2 = utils.assert;
      function ShortCurve(conf) {
        Base.call(this, "short", conf);
        this.a = new BN(conf.a, 16).toRed(this.red);
        this.b = new BN(conf.b, 16).toRed(this.red);
        this.tinv = this.two.redInvm();
        this.zeroA = this.a.fromRed().cmpn(0) === 0;
        this.threeA = this.a.fromRed().sub(this.p).cmpn(-3) === 0;
        this.endo = this._getEndomorphism(conf);
        this._endoWnafT1 = new Array(4);
        this._endoWnafT2 = new Array(4);
      }
      inherits(ShortCurve, Base);
      module.exports = ShortCurve;
      ShortCurve.prototype._getEndomorphism = function _getEndomorphism(conf) {
        if (!this.zeroA || !this.g || !this.n || this.p.modn(3) !== 1)
          return;
        var beta;
        var lambda;
        if (conf.beta) {
          beta = new BN(conf.beta, 16).toRed(this.red);
        } else {
          var betas = this._getEndoRoots(this.p);
          beta = betas[0].cmp(betas[1]) < 0 ? betas[0] : betas[1];
          beta = beta.toRed(this.red);
        }
        if (conf.lambda) {
          lambda = new BN(conf.lambda, 16);
        } else {
          var lambdas = this._getEndoRoots(this.n);
          if (this.g.mul(lambdas[0]).x.cmp(this.g.x.redMul(beta)) === 0) {
            lambda = lambdas[0];
          } else {
            lambda = lambdas[1];
            assert2(this.g.mul(lambda).x.cmp(this.g.x.redMul(beta)) === 0);
          }
        }
        var basis;
        if (conf.basis) {
          basis = conf.basis.map(function(vec) {
            return {
              a: new BN(vec.a, 16),
              b: new BN(vec.b, 16)
            };
          });
        } else {
          basis = this._getEndoBasis(lambda);
        }
        return {
          beta,
          lambda,
          basis
        };
      };
      ShortCurve.prototype._getEndoRoots = function _getEndoRoots(num) {
        var red = num === this.p ? this.red : BN.mont(num);
        var tinv = new BN(2).toRed(red).redInvm();
        var ntinv = tinv.redNeg();
        var s = new BN(3).toRed(red).redNeg().redSqrt().redMul(tinv);
        var l1 = ntinv.redAdd(s).fromRed();
        var l2 = ntinv.redSub(s).fromRed();
        return [l1, l2];
      };
      ShortCurve.prototype._getEndoBasis = function _getEndoBasis(lambda) {
        var aprxSqrt = this.n.ushrn(Math.floor(this.n.bitLength() / 2));
        var u = lambda;
        var v = this.n.clone();
        var x1 = new BN(1);
        var y1 = new BN(0);
        var x2 = new BN(0);
        var y2 = new BN(1);
        var a0;
        var b0;
        var a1;
        var b1;
        var a2;
        var b2;
        var prevR;
        var i = 0;
        var r;
        var x;
        while (u.cmpn(0) !== 0) {
          var q = v.div(u);
          r = v.sub(q.mul(u));
          x = x2.sub(q.mul(x1));
          var y = y2.sub(q.mul(y1));
          if (!a1 && r.cmp(aprxSqrt) < 0) {
            a0 = prevR.neg();
            b0 = x1;
            a1 = r.neg();
            b1 = x;
          } else if (a1 && ++i === 2) {
            break;
          }
          prevR = r;
          v = u;
          u = r;
          x2 = x1;
          x1 = x;
          y2 = y1;
          y1 = y;
        }
        a2 = r.neg();
        b2 = x;
        var len1 = a1.sqr().add(b1.sqr());
        var len2 = a2.sqr().add(b2.sqr());
        if (len2.cmp(len1) >= 0) {
          a2 = a0;
          b2 = b0;
        }
        if (a1.negative) {
          a1 = a1.neg();
          b1 = b1.neg();
        }
        if (a2.negative) {
          a2 = a2.neg();
          b2 = b2.neg();
        }
        return [
          { a: a1, b: b1 },
          { a: a2, b: b2 }
        ];
      };
      ShortCurve.prototype._endoSplit = function _endoSplit(k) {
        var basis = this.endo.basis;
        var v1 = basis[0];
        var v2 = basis[1];
        var c1 = v2.b.mul(k).divRound(this.n);
        var c2 = v1.b.neg().mul(k).divRound(this.n);
        var p1 = c1.mul(v1.a);
        var p2 = c2.mul(v2.a);
        var q1 = c1.mul(v1.b);
        var q2 = c2.mul(v2.b);
        var k1 = k.sub(p1).sub(p2);
        var k2 = q1.add(q2).neg();
        return { k1, k2 };
      };
      ShortCurve.prototype.pointFromX = function pointFromX(x, odd) {
        x = new BN(x, 16);
        if (!x.red)
          x = x.toRed(this.red);
        var y2 = x.redSqr().redMul(x).redIAdd(x.redMul(this.a)).redIAdd(this.b);
        var y = y2.redSqrt();
        if (y.redSqr().redSub(y2).cmp(this.zero) !== 0)
          throw new Error("invalid point");
        var isOdd = y.fromRed().isOdd();
        if (odd && !isOdd || !odd && isOdd)
          y = y.redNeg();
        return this.point(x, y);
      };
      ShortCurve.prototype.validate = function validate(point) {
        if (point.inf)
          return true;
        var x = point.x;
        var y = point.y;
        var ax = this.a.redMul(x);
        var rhs = x.redSqr().redMul(x).redIAdd(ax).redIAdd(this.b);
        return y.redSqr().redISub(rhs).cmpn(0) === 0;
      };
      ShortCurve.prototype._endoWnafMulAdd = function _endoWnafMulAdd(points, coeffs, jacobianResult) {
        var npoints = this._endoWnafT1;
        var ncoeffs = this._endoWnafT2;
        for (var i = 0; i < points.length; i++) {
          var split3 = this._endoSplit(coeffs[i]);
          var p = points[i];
          var beta = p._getBeta();
          if (split3.k1.negative) {
            split3.k1.ineg();
            p = p.neg(true);
          }
          if (split3.k2.negative) {
            split3.k2.ineg();
            beta = beta.neg(true);
          }
          npoints[i * 2] = p;
          npoints[i * 2 + 1] = beta;
          ncoeffs[i * 2] = split3.k1;
          ncoeffs[i * 2 + 1] = split3.k2;
        }
        var res = this._wnafMulAdd(1, npoints, ncoeffs, i * 2, jacobianResult);
        for (var j = 0; j < i * 2; j++) {
          npoints[j] = null;
          ncoeffs[j] = null;
        }
        return res;
      };
      function Point(curve, x, y, isRed) {
        Base.BasePoint.call(this, curve, "affine");
        if (x === null && y === null) {
          this.x = null;
          this.y = null;
          this.inf = true;
        } else {
          this.x = new BN(x, 16);
          this.y = new BN(y, 16);
          if (isRed) {
            this.x.forceRed(this.curve.red);
            this.y.forceRed(this.curve.red);
          }
          if (!this.x.red)
            this.x = this.x.toRed(this.curve.red);
          if (!this.y.red)
            this.y = this.y.toRed(this.curve.red);
          this.inf = false;
        }
      }
      inherits(Point, Base.BasePoint);
      ShortCurve.prototype.point = function point(x, y, isRed) {
        return new Point(this, x, y, isRed);
      };
      ShortCurve.prototype.pointFromJSON = function pointFromJSON(obj, red) {
        return Point.fromJSON(this, obj, red);
      };
      Point.prototype._getBeta = function _getBeta() {
        if (!this.curve.endo)
          return;
        var pre = this.precomputed;
        if (pre && pre.beta)
          return pre.beta;
        var beta = this.curve.point(this.x.redMul(this.curve.endo.beta), this.y);
        if (pre) {
          var curve = this.curve;
          var endoMul = function(p) {
            return curve.point(p.x.redMul(curve.endo.beta), p.y);
          };
          pre.beta = beta;
          beta.precomputed = {
            beta: null,
            naf: pre.naf && {
              wnd: pre.naf.wnd,
              points: pre.naf.points.map(endoMul)
            },
            doubles: pre.doubles && {
              step: pre.doubles.step,
              points: pre.doubles.points.map(endoMul)
            }
          };
        }
        return beta;
      };
      Point.prototype.toJSON = function toJSON() {
        if (!this.precomputed)
          return [this.x, this.y];
        return [this.x, this.y, this.precomputed && {
          doubles: this.precomputed.doubles && {
            step: this.precomputed.doubles.step,
            points: this.precomputed.doubles.points.slice(1)
          },
          naf: this.precomputed.naf && {
            wnd: this.precomputed.naf.wnd,
            points: this.precomputed.naf.points.slice(1)
          }
        }];
      };
      Point.fromJSON = function fromJSON(curve, obj, red) {
        if (typeof obj === "string")
          obj = JSON.parse(obj);
        var res = curve.point(obj[0], obj[1], red);
        if (!obj[2])
          return res;
        function obj2point(obj2) {
          return curve.point(obj2[0], obj2[1], red);
        }
        var pre = obj[2];
        res.precomputed = {
          beta: null,
          doubles: pre.doubles && {
            step: pre.doubles.step,
            points: [res].concat(pre.doubles.points.map(obj2point))
          },
          naf: pre.naf && {
            wnd: pre.naf.wnd,
            points: [res].concat(pre.naf.points.map(obj2point))
          }
        };
        return res;
      };
      Point.prototype.inspect = function inspect() {
        if (this.isInfinity())
          return "<EC Point Infinity>";
        return "<EC Point x: " + this.x.fromRed().toString(16, 2) + " y: " + this.y.fromRed().toString(16, 2) + ">";
      };
      Point.prototype.isInfinity = function isInfinity() {
        return this.inf;
      };
      Point.prototype.add = function add2(p) {
        if (this.inf)
          return p;
        if (p.inf)
          return this;
        if (this.eq(p))
          return this.dbl();
        if (this.neg().eq(p))
          return this.curve.point(null, null);
        if (this.x.cmp(p.x) === 0)
          return this.curve.point(null, null);
        var c = this.y.redSub(p.y);
        if (c.cmpn(0) !== 0)
          c = c.redMul(this.x.redSub(p.x).redInvm());
        var nx = c.redSqr().redISub(this.x).redISub(p.x);
        var ny = c.redMul(this.x.redSub(nx)).redISub(this.y);
        return this.curve.point(nx, ny);
      };
      Point.prototype.dbl = function dbl() {
        if (this.inf)
          return this;
        var ys1 = this.y.redAdd(this.y);
        if (ys1.cmpn(0) === 0)
          return this.curve.point(null, null);
        var a = this.curve.a;
        var x2 = this.x.redSqr();
        var dyinv = ys1.redInvm();
        var c = x2.redAdd(x2).redIAdd(x2).redIAdd(a).redMul(dyinv);
        var nx = c.redSqr().redISub(this.x.redAdd(this.x));
        var ny = c.redMul(this.x.redSub(nx)).redISub(this.y);
        return this.curve.point(nx, ny);
      };
      Point.prototype.getX = function getX() {
        return this.x.fromRed();
      };
      Point.prototype.getY = function getY() {
        return this.y.fromRed();
      };
      Point.prototype.mul = function mul(k) {
        k = new BN(k, 16);
        if (this.isInfinity())
          return this;
        else if (this._hasDoubles(k))
          return this.curve._fixedNafMul(this, k);
        else if (this.curve.endo)
          return this.curve._endoWnafMulAdd([this], [k]);
        else
          return this.curve._wnafMul(this, k);
      };
      Point.prototype.mulAdd = function mulAdd(k1, p2, k2) {
        var points = [this, p2];
        var coeffs = [k1, k2];
        if (this.curve.endo)
          return this.curve._endoWnafMulAdd(points, coeffs);
        else
          return this.curve._wnafMulAdd(1, points, coeffs, 2);
      };
      Point.prototype.jmulAdd = function jmulAdd(k1, p2, k2) {
        var points = [this, p2];
        var coeffs = [k1, k2];
        if (this.curve.endo)
          return this.curve._endoWnafMulAdd(points, coeffs, true);
        else
          return this.curve._wnafMulAdd(1, points, coeffs, 2, true);
      };
      Point.prototype.eq = function eq(p) {
        return this === p || this.inf === p.inf && (this.inf || this.x.cmp(p.x) === 0 && this.y.cmp(p.y) === 0);
      };
      Point.prototype.neg = function neg(_precompute) {
        if (this.inf)
          return this;
        var res = this.curve.point(this.x, this.y.redNeg());
        if (_precompute && this.precomputed) {
          var pre = this.precomputed;
          var negate = function(p) {
            return p.neg();
          };
          res.precomputed = {
            naf: pre.naf && {
              wnd: pre.naf.wnd,
              points: pre.naf.points.map(negate)
            },
            doubles: pre.doubles && {
              step: pre.doubles.step,
              points: pre.doubles.points.map(negate)
            }
          };
        }
        return res;
      };
      Point.prototype.toJ = function toJ() {
        if (this.inf)
          return this.curve.jpoint(null, null, null);
        var res = this.curve.jpoint(this.x, this.y, this.curve.one);
        return res;
      };
      function JPoint(curve, x, y, z) {
        Base.BasePoint.call(this, curve, "jacobian");
        if (x === null && y === null && z === null) {
          this.x = this.curve.one;
          this.y = this.curve.one;
          this.z = new BN(0);
        } else {
          this.x = new BN(x, 16);
          this.y = new BN(y, 16);
          this.z = new BN(z, 16);
        }
        if (!this.x.red)
          this.x = this.x.toRed(this.curve.red);
        if (!this.y.red)
          this.y = this.y.toRed(this.curve.red);
        if (!this.z.red)
          this.z = this.z.toRed(this.curve.red);
        this.zOne = this.z === this.curve.one;
      }
      inherits(JPoint, Base.BasePoint);
      ShortCurve.prototype.jpoint = function jpoint(x, y, z) {
        return new JPoint(this, x, y, z);
      };
      JPoint.prototype.toP = function toP() {
        if (this.isInfinity())
          return this.curve.point(null, null);
        var zinv = this.z.redInvm();
        var zinv2 = zinv.redSqr();
        var ax = this.x.redMul(zinv2);
        var ay = this.y.redMul(zinv2).redMul(zinv);
        return this.curve.point(ax, ay);
      };
      JPoint.prototype.neg = function neg() {
        return this.curve.jpoint(this.x, this.y.redNeg(), this.z);
      };
      JPoint.prototype.add = function add2(p) {
        if (this.isInfinity())
          return p;
        if (p.isInfinity())
          return this;
        var pz2 = p.z.redSqr();
        var z2 = this.z.redSqr();
        var u1 = this.x.redMul(pz2);
        var u2 = p.x.redMul(z2);
        var s1 = this.y.redMul(pz2.redMul(p.z));
        var s2 = p.y.redMul(z2.redMul(this.z));
        var h = u1.redSub(u2);
        var r = s1.redSub(s2);
        if (h.cmpn(0) === 0) {
          if (r.cmpn(0) !== 0)
            return this.curve.jpoint(null, null, null);
          else
            return this.dbl();
        }
        var h2 = h.redSqr();
        var h3 = h2.redMul(h);
        var v = u1.redMul(h2);
        var nx = r.redSqr().redIAdd(h3).redISub(v).redISub(v);
        var ny = r.redMul(v.redISub(nx)).redISub(s1.redMul(h3));
        var nz = this.z.redMul(p.z).redMul(h);
        return this.curve.jpoint(nx, ny, nz);
      };
      JPoint.prototype.mixedAdd = function mixedAdd(p) {
        if (this.isInfinity())
          return p.toJ();
        if (p.isInfinity())
          return this;
        var z2 = this.z.redSqr();
        var u1 = this.x;
        var u2 = p.x.redMul(z2);
        var s1 = this.y;
        var s2 = p.y.redMul(z2).redMul(this.z);
        var h = u1.redSub(u2);
        var r = s1.redSub(s2);
        if (h.cmpn(0) === 0) {
          if (r.cmpn(0) !== 0)
            return this.curve.jpoint(null, null, null);
          else
            return this.dbl();
        }
        var h2 = h.redSqr();
        var h3 = h2.redMul(h);
        var v = u1.redMul(h2);
        var nx = r.redSqr().redIAdd(h3).redISub(v).redISub(v);
        var ny = r.redMul(v.redISub(nx)).redISub(s1.redMul(h3));
        var nz = this.z.redMul(h);
        return this.curve.jpoint(nx, ny, nz);
      };
      JPoint.prototype.dblp = function dblp(pow) {
        if (pow === 0)
          return this;
        if (this.isInfinity())
          return this;
        if (!pow)
          return this.dbl();
        var i;
        if (this.curve.zeroA || this.curve.threeA) {
          var r = this;
          for (i = 0; i < pow; i++)
            r = r.dbl();
          return r;
        }
        var a = this.curve.a;
        var tinv = this.curve.tinv;
        var jx = this.x;
        var jy = this.y;
        var jz = this.z;
        var jz4 = jz.redSqr().redSqr();
        var jyd = jy.redAdd(jy);
        for (i = 0; i < pow; i++) {
          var jx2 = jx.redSqr();
          var jyd2 = jyd.redSqr();
          var jyd4 = jyd2.redSqr();
          var c = jx2.redAdd(jx2).redIAdd(jx2).redIAdd(a.redMul(jz4));
          var t1 = jx.redMul(jyd2);
          var nx = c.redSqr().redISub(t1.redAdd(t1));
          var t2 = t1.redISub(nx);
          var dny = c.redMul(t2);
          dny = dny.redIAdd(dny).redISub(jyd4);
          var nz = jyd.redMul(jz);
          if (i + 1 < pow)
            jz4 = jz4.redMul(jyd4);
          jx = nx;
          jz = nz;
          jyd = dny;
        }
        return this.curve.jpoint(jx, jyd.redMul(tinv), jz);
      };
      JPoint.prototype.dbl = function dbl() {
        if (this.isInfinity())
          return this;
        if (this.curve.zeroA)
          return this._zeroDbl();
        else if (this.curve.threeA)
          return this._threeDbl();
        else
          return this._dbl();
      };
      JPoint.prototype._zeroDbl = function _zeroDbl() {
        var nx;
        var ny;
        var nz;
        if (this.zOne) {
          var xx = this.x.redSqr();
          var yy = this.y.redSqr();
          var yyyy = yy.redSqr();
          var s = this.x.redAdd(yy).redSqr().redISub(xx).redISub(yyyy);
          s = s.redIAdd(s);
          var m = xx.redAdd(xx).redIAdd(xx);
          var t = m.redSqr().redISub(s).redISub(s);
          var yyyy8 = yyyy.redIAdd(yyyy);
          yyyy8 = yyyy8.redIAdd(yyyy8);
          yyyy8 = yyyy8.redIAdd(yyyy8);
          nx = t;
          ny = m.redMul(s.redISub(t)).redISub(yyyy8);
          nz = this.y.redAdd(this.y);
        } else {
          var a = this.x.redSqr();
          var b = this.y.redSqr();
          var c = b.redSqr();
          var d = this.x.redAdd(b).redSqr().redISub(a).redISub(c);
          d = d.redIAdd(d);
          var e = a.redAdd(a).redIAdd(a);
          var f = e.redSqr();
          var c8 = c.redIAdd(c);
          c8 = c8.redIAdd(c8);
          c8 = c8.redIAdd(c8);
          nx = f.redISub(d).redISub(d);
          ny = e.redMul(d.redISub(nx)).redISub(c8);
          nz = this.y.redMul(this.z);
          nz = nz.redIAdd(nz);
        }
        return this.curve.jpoint(nx, ny, nz);
      };
      JPoint.prototype._threeDbl = function _threeDbl() {
        var nx;
        var ny;
        var nz;
        if (this.zOne) {
          var xx = this.x.redSqr();
          var yy = this.y.redSqr();
          var yyyy = yy.redSqr();
          var s = this.x.redAdd(yy).redSqr().redISub(xx).redISub(yyyy);
          s = s.redIAdd(s);
          var m = xx.redAdd(xx).redIAdd(xx).redIAdd(this.curve.a);
          var t = m.redSqr().redISub(s).redISub(s);
          nx = t;
          var yyyy8 = yyyy.redIAdd(yyyy);
          yyyy8 = yyyy8.redIAdd(yyyy8);
          yyyy8 = yyyy8.redIAdd(yyyy8);
          ny = m.redMul(s.redISub(t)).redISub(yyyy8);
          nz = this.y.redAdd(this.y);
        } else {
          var delta = this.z.redSqr();
          var gamma = this.y.redSqr();
          var beta = this.x.redMul(gamma);
          var alpha = this.x.redSub(delta).redMul(this.x.redAdd(delta));
          alpha = alpha.redAdd(alpha).redIAdd(alpha);
          var beta4 = beta.redIAdd(beta);
          beta4 = beta4.redIAdd(beta4);
          var beta8 = beta4.redAdd(beta4);
          nx = alpha.redSqr().redISub(beta8);
          nz = this.y.redAdd(this.z).redSqr().redISub(gamma).redISub(delta);
          var ggamma8 = gamma.redSqr();
          ggamma8 = ggamma8.redIAdd(ggamma8);
          ggamma8 = ggamma8.redIAdd(ggamma8);
          ggamma8 = ggamma8.redIAdd(ggamma8);
          ny = alpha.redMul(beta4.redISub(nx)).redISub(ggamma8);
        }
        return this.curve.jpoint(nx, ny, nz);
      };
      JPoint.prototype._dbl = function _dbl() {
        var a = this.curve.a;
        var jx = this.x;
        var jy = this.y;
        var jz = this.z;
        var jz4 = jz.redSqr().redSqr();
        var jx2 = jx.redSqr();
        var jy2 = jy.redSqr();
        var c = jx2.redAdd(jx2).redIAdd(jx2).redIAdd(a.redMul(jz4));
        var jxd4 = jx.redAdd(jx);
        jxd4 = jxd4.redIAdd(jxd4);
        var t1 = jxd4.redMul(jy2);
        var nx = c.redSqr().redISub(t1.redAdd(t1));
        var t2 = t1.redISub(nx);
        var jyd8 = jy2.redSqr();
        jyd8 = jyd8.redIAdd(jyd8);
        jyd8 = jyd8.redIAdd(jyd8);
        jyd8 = jyd8.redIAdd(jyd8);
        var ny = c.redMul(t2).redISub(jyd8);
        var nz = jy.redAdd(jy).redMul(jz);
        return this.curve.jpoint(nx, ny, nz);
      };
      JPoint.prototype.trpl = function trpl() {
        if (!this.curve.zeroA)
          return this.dbl().add(this);
        var xx = this.x.redSqr();
        var yy = this.y.redSqr();
        var zz = this.z.redSqr();
        var yyyy = yy.redSqr();
        var m = xx.redAdd(xx).redIAdd(xx);
        var mm = m.redSqr();
        var e = this.x.redAdd(yy).redSqr().redISub(xx).redISub(yyyy);
        e = e.redIAdd(e);
        e = e.redAdd(e).redIAdd(e);
        e = e.redISub(mm);
        var ee = e.redSqr();
        var t = yyyy.redIAdd(yyyy);
        t = t.redIAdd(t);
        t = t.redIAdd(t);
        t = t.redIAdd(t);
        var u = m.redIAdd(e).redSqr().redISub(mm).redISub(ee).redISub(t);
        var yyu4 = yy.redMul(u);
        yyu4 = yyu4.redIAdd(yyu4);
        yyu4 = yyu4.redIAdd(yyu4);
        var nx = this.x.redMul(ee).redISub(yyu4);
        nx = nx.redIAdd(nx);
        nx = nx.redIAdd(nx);
        var ny = this.y.redMul(u.redMul(t.redISub(u)).redISub(e.redMul(ee)));
        ny = ny.redIAdd(ny);
        ny = ny.redIAdd(ny);
        ny = ny.redIAdd(ny);
        var nz = this.z.redAdd(e).redSqr().redISub(zz).redISub(ee);
        return this.curve.jpoint(nx, ny, nz);
      };
      JPoint.prototype.mul = function mul(k, kbase) {
        k = new BN(k, kbase);
        return this.curve._wnafMul(this, k);
      };
      JPoint.prototype.eq = function eq(p) {
        if (p.type === "affine")
          return this.eq(p.toJ());
        if (this === p)
          return true;
        var z2 = this.z.redSqr();
        var pz2 = p.z.redSqr();
        if (this.x.redMul(pz2).redISub(p.x.redMul(z2)).cmpn(0) !== 0)
          return false;
        var z3 = z2.redMul(this.z);
        var pz3 = pz2.redMul(p.z);
        return this.y.redMul(pz3).redISub(p.y.redMul(z3)).cmpn(0) === 0;
      };
      JPoint.prototype.eqXToP = function eqXToP(x) {
        var zs = this.z.redSqr();
        var rx = x.toRed(this.curve.red).redMul(zs);
        if (this.x.cmp(rx) === 0)
          return true;
        var xc = x.clone();
        var t = this.curve.redN.redMul(zs);
        for (; ; ) {
          xc.iadd(this.curve.n);
          if (xc.cmp(this.curve.p) >= 0)
            return false;
          rx.redIAdd(t);
          if (this.x.cmp(rx) === 0)
            return true;
        }
      };
      JPoint.prototype.inspect = function inspect() {
        if (this.isInfinity())
          return "<EC JPoint Infinity>";
        return "<EC JPoint x: " + this.x.toString(16, 2) + " y: " + this.y.toString(16, 2) + " z: " + this.z.toString(16, 2) + ">";
      };
      JPoint.prototype.isInfinity = function isInfinity() {
        return this.z.cmpn(0) === 0;
      };
    }
  });

  // node_modules/elliptic/lib/elliptic/curve/mont.js
  var require_mont = __commonJS({
    "node_modules/elliptic/lib/elliptic/curve/mont.js"(exports, module) {
      "use strict";
      var BN = require_bn();
      var inherits = require_inherits_browser();
      var Base = require_base();
      var utils = require_utils2();
      function MontCurve(conf) {
        Base.call(this, "mont", conf);
        this.a = new BN(conf.a, 16).toRed(this.red);
        this.b = new BN(conf.b, 16).toRed(this.red);
        this.i4 = new BN(4).toRed(this.red).redInvm();
        this.two = new BN(2).toRed(this.red);
        this.a24 = this.i4.redMul(this.a.redAdd(this.two));
      }
      inherits(MontCurve, Base);
      module.exports = MontCurve;
      MontCurve.prototype.validate = function validate(point) {
        var x = point.normalize().x;
        var x2 = x.redSqr();
        var rhs = x2.redMul(x).redAdd(x2.redMul(this.a)).redAdd(x);
        var y = rhs.redSqrt();
        return y.redSqr().cmp(rhs) === 0;
      };
      function Point(curve, x, z) {
        Base.BasePoint.call(this, curve, "projective");
        if (x === null && z === null) {
          this.x = this.curve.one;
          this.z = this.curve.zero;
        } else {
          this.x = new BN(x, 16);
          this.z = new BN(z, 16);
          if (!this.x.red)
            this.x = this.x.toRed(this.curve.red);
          if (!this.z.red)
            this.z = this.z.toRed(this.curve.red);
        }
      }
      inherits(Point, Base.BasePoint);
      MontCurve.prototype.decodePoint = function decodePoint(bytes2, enc) {
        return this.point(utils.toArray(bytes2, enc), 1);
      };
      MontCurve.prototype.point = function point(x, z) {
        return new Point(this, x, z);
      };
      MontCurve.prototype.pointFromJSON = function pointFromJSON(obj) {
        return Point.fromJSON(this, obj);
      };
      Point.prototype.precompute = function precompute() {
      };
      Point.prototype._encode = function _encode() {
        return this.getX().toArray("be", this.curve.p.byteLength());
      };
      Point.fromJSON = function fromJSON(curve, obj) {
        return new Point(curve, obj[0], obj[1] || curve.one);
      };
      Point.prototype.inspect = function inspect() {
        if (this.isInfinity())
          return "<EC Point Infinity>";
        return "<EC Point x: " + this.x.fromRed().toString(16, 2) + " z: " + this.z.fromRed().toString(16, 2) + ">";
      };
      Point.prototype.isInfinity = function isInfinity() {
        return this.z.cmpn(0) === 0;
      };
      Point.prototype.dbl = function dbl() {
        var a = this.x.redAdd(this.z);
        var aa = a.redSqr();
        var b = this.x.redSub(this.z);
        var bb = b.redSqr();
        var c = aa.redSub(bb);
        var nx = aa.redMul(bb);
        var nz = c.redMul(bb.redAdd(this.curve.a24.redMul(c)));
        return this.curve.point(nx, nz);
      };
      Point.prototype.add = function add2() {
        throw new Error("Not supported on Montgomery curve");
      };
      Point.prototype.diffAdd = function diffAdd(p, diff) {
        var a = this.x.redAdd(this.z);
        var b = this.x.redSub(this.z);
        var c = p.x.redAdd(p.z);
        var d = p.x.redSub(p.z);
        var da = d.redMul(a);
        var cb = c.redMul(b);
        var nx = diff.z.redMul(da.redAdd(cb).redSqr());
        var nz = diff.x.redMul(da.redISub(cb).redSqr());
        return this.curve.point(nx, nz);
      };
      Point.prototype.mul = function mul(k) {
        var t = k.clone();
        var a = this;
        var b = this.curve.point(null, null);
        var c = this;
        for (var bits = []; t.cmpn(0) !== 0; t.iushrn(1))
          bits.push(t.andln(1));
        for (var i = bits.length - 1; i >= 0; i--) {
          if (bits[i] === 0) {
            a = a.diffAdd(b, c);
            b = b.dbl();
          } else {
            b = a.diffAdd(b, c);
            a = a.dbl();
          }
        }
        return b;
      };
      Point.prototype.mulAdd = function mulAdd() {
        throw new Error("Not supported on Montgomery curve");
      };
      Point.prototype.jumlAdd = function jumlAdd() {
        throw new Error("Not supported on Montgomery curve");
      };
      Point.prototype.eq = function eq(other) {
        return this.getX().cmp(other.getX()) === 0;
      };
      Point.prototype.normalize = function normalize() {
        this.x = this.x.redMul(this.z.redInvm());
        this.z = this.curve.one;
        return this;
      };
      Point.prototype.getX = function getX() {
        this.normalize();
        return this.x.fromRed();
      };
    }
  });

  // node_modules/elliptic/lib/elliptic/curve/edwards.js
  var require_edwards = __commonJS({
    "node_modules/elliptic/lib/elliptic/curve/edwards.js"(exports, module) {
      "use strict";
      var utils = require_utils2();
      var BN = require_bn();
      var inherits = require_inherits_browser();
      var Base = require_base();
      var assert2 = utils.assert;
      function EdwardsCurve(conf) {
        this.twisted = (conf.a | 0) !== 1;
        this.mOneA = this.twisted && (conf.a | 0) === -1;
        this.extended = this.mOneA;
        Base.call(this, "edwards", conf);
        this.a = new BN(conf.a, 16).umod(this.red.m);
        this.a = this.a.toRed(this.red);
        this.c = new BN(conf.c, 16).toRed(this.red);
        this.c2 = this.c.redSqr();
        this.d = new BN(conf.d, 16).toRed(this.red);
        this.dd = this.d.redAdd(this.d);
        assert2(!this.twisted || this.c.fromRed().cmpn(1) === 0);
        this.oneC = (conf.c | 0) === 1;
      }
      inherits(EdwardsCurve, Base);
      module.exports = EdwardsCurve;
      EdwardsCurve.prototype._mulA = function _mulA(num) {
        if (this.mOneA)
          return num.redNeg();
        else
          return this.a.redMul(num);
      };
      EdwardsCurve.prototype._mulC = function _mulC(num) {
        if (this.oneC)
          return num;
        else
          return this.c.redMul(num);
      };
      EdwardsCurve.prototype.jpoint = function jpoint(x, y, z, t) {
        return this.point(x, y, z, t);
      };
      EdwardsCurve.prototype.pointFromX = function pointFromX(x, odd) {
        x = new BN(x, 16);
        if (!x.red)
          x = x.toRed(this.red);
        var x2 = x.redSqr();
        var rhs = this.c2.redSub(this.a.redMul(x2));
        var lhs = this.one.redSub(this.c2.redMul(this.d).redMul(x2));
        var y2 = rhs.redMul(lhs.redInvm());
        var y = y2.redSqrt();
        if (y.redSqr().redSub(y2).cmp(this.zero) !== 0)
          throw new Error("invalid point");
        var isOdd = y.fromRed().isOdd();
        if (odd && !isOdd || !odd && isOdd)
          y = y.redNeg();
        return this.point(x, y);
      };
      EdwardsCurve.prototype.pointFromY = function pointFromY(y, odd) {
        y = new BN(y, 16);
        if (!y.red)
          y = y.toRed(this.red);
        var y2 = y.redSqr();
        var lhs = y2.redSub(this.c2);
        var rhs = y2.redMul(this.d).redMul(this.c2).redSub(this.a);
        var x2 = lhs.redMul(rhs.redInvm());
        if (x2.cmp(this.zero) === 0) {
          if (odd)
            throw new Error("invalid point");
          else
            return this.point(this.zero, y);
        }
        var x = x2.redSqrt();
        if (x.redSqr().redSub(x2).cmp(this.zero) !== 0)
          throw new Error("invalid point");
        if (x.fromRed().isOdd() !== odd)
          x = x.redNeg();
        return this.point(x, y);
      };
      EdwardsCurve.prototype.validate = function validate(point) {
        if (point.isInfinity())
          return true;
        point.normalize();
        var x2 = point.x.redSqr();
        var y2 = point.y.redSqr();
        var lhs = x2.redMul(this.a).redAdd(y2);
        var rhs = this.c2.redMul(this.one.redAdd(this.d.redMul(x2).redMul(y2)));
        return lhs.cmp(rhs) === 0;
      };
      function Point(curve, x, y, z, t) {
        Base.BasePoint.call(this, curve, "projective");
        if (x === null && y === null && z === null) {
          this.x = this.curve.zero;
          this.y = this.curve.one;
          this.z = this.curve.one;
          this.t = this.curve.zero;
          this.zOne = true;
        } else {
          this.x = new BN(x, 16);
          this.y = new BN(y, 16);
          this.z = z ? new BN(z, 16) : this.curve.one;
          this.t = t && new BN(t, 16);
          if (!this.x.red)
            this.x = this.x.toRed(this.curve.red);
          if (!this.y.red)
            this.y = this.y.toRed(this.curve.red);
          if (!this.z.red)
            this.z = this.z.toRed(this.curve.red);
          if (this.t && !this.t.red)
            this.t = this.t.toRed(this.curve.red);
          this.zOne = this.z === this.curve.one;
          if (this.curve.extended && !this.t) {
            this.t = this.x.redMul(this.y);
            if (!this.zOne)
              this.t = this.t.redMul(this.z.redInvm());
          }
        }
      }
      inherits(Point, Base.BasePoint);
      EdwardsCurve.prototype.pointFromJSON = function pointFromJSON(obj) {
        return Point.fromJSON(this, obj);
      };
      EdwardsCurve.prototype.point = function point(x, y, z, t) {
        return new Point(this, x, y, z, t);
      };
      Point.fromJSON = function fromJSON(curve, obj) {
        return new Point(curve, obj[0], obj[1], obj[2]);
      };
      Point.prototype.inspect = function inspect() {
        if (this.isInfinity())
          return "<EC Point Infinity>";
        return "<EC Point x: " + this.x.fromRed().toString(16, 2) + " y: " + this.y.fromRed().toString(16, 2) + " z: " + this.z.fromRed().toString(16, 2) + ">";
      };
      Point.prototype.isInfinity = function isInfinity() {
        return this.x.cmpn(0) === 0 && (this.y.cmp(this.z) === 0 || this.zOne && this.y.cmp(this.curve.c) === 0);
      };
      Point.prototype._extDbl = function _extDbl() {
        var a = this.x.redSqr();
        var b = this.y.redSqr();
        var c = this.z.redSqr();
        c = c.redIAdd(c);
        var d = this.curve._mulA(a);
        var e = this.x.redAdd(this.y).redSqr().redISub(a).redISub(b);
        var g = d.redAdd(b);
        var f = g.redSub(c);
        var h = d.redSub(b);
        var nx = e.redMul(f);
        var ny = g.redMul(h);
        var nt = e.redMul(h);
        var nz = f.redMul(g);
        return this.curve.point(nx, ny, nz, nt);
      };
      Point.prototype._projDbl = function _projDbl() {
        var b = this.x.redAdd(this.y).redSqr();
        var c = this.x.redSqr();
        var d = this.y.redSqr();
        var nx;
        var ny;
        var nz;
        var e;
        var h;
        var j;
        if (this.curve.twisted) {
          e = this.curve._mulA(c);
          var f = e.redAdd(d);
          if (this.zOne) {
            nx = b.redSub(c).redSub(d).redMul(f.redSub(this.curve.two));
            ny = f.redMul(e.redSub(d));
            nz = f.redSqr().redSub(f).redSub(f);
          } else {
            h = this.z.redSqr();
            j = f.redSub(h).redISub(h);
            nx = b.redSub(c).redISub(d).redMul(j);
            ny = f.redMul(e.redSub(d));
            nz = f.redMul(j);
          }
        } else {
          e = c.redAdd(d);
          h = this.curve._mulC(this.z).redSqr();
          j = e.redSub(h).redSub(h);
          nx = this.curve._mulC(b.redISub(e)).redMul(j);
          ny = this.curve._mulC(e).redMul(c.redISub(d));
          nz = e.redMul(j);
        }
        return this.curve.point(nx, ny, nz);
      };
      Point.prototype.dbl = function dbl() {
        if (this.isInfinity())
          return this;
        if (this.curve.extended)
          return this._extDbl();
        else
          return this._projDbl();
      };
      Point.prototype._extAdd = function _extAdd(p) {
        var a = this.y.redSub(this.x).redMul(p.y.redSub(p.x));
        var b = this.y.redAdd(this.x).redMul(p.y.redAdd(p.x));
        var c = this.t.redMul(this.curve.dd).redMul(p.t);
        var d = this.z.redMul(p.z.redAdd(p.z));
        var e = b.redSub(a);
        var f = d.redSub(c);
        var g = d.redAdd(c);
        var h = b.redAdd(a);
        var nx = e.redMul(f);
        var ny = g.redMul(h);
        var nt = e.redMul(h);
        var nz = f.redMul(g);
        return this.curve.point(nx, ny, nz, nt);
      };
      Point.prototype._projAdd = function _projAdd(p) {
        var a = this.z.redMul(p.z);
        var b = a.redSqr();
        var c = this.x.redMul(p.x);
        var d = this.y.redMul(p.y);
        var e = this.curve.d.redMul(c).redMul(d);
        var f = b.redSub(e);
        var g = b.redAdd(e);
        var tmp = this.x.redAdd(this.y).redMul(p.x.redAdd(p.y)).redISub(c).redISub(d);
        var nx = a.redMul(f).redMul(tmp);
        var ny;
        var nz;
        if (this.curve.twisted) {
          ny = a.redMul(g).redMul(d.redSub(this.curve._mulA(c)));
          nz = f.redMul(g);
        } else {
          ny = a.redMul(g).redMul(d.redSub(c));
          nz = this.curve._mulC(f).redMul(g);
        }
        return this.curve.point(nx, ny, nz);
      };
      Point.prototype.add = function add2(p) {
        if (this.isInfinity())
          return p;
        if (p.isInfinity())
          return this;
        if (this.curve.extended)
          return this._extAdd(p);
        else
          return this._projAdd(p);
      };
      Point.prototype.mul = function mul(k) {
        if (this._hasDoubles(k))
          return this.curve._fixedNafMul(this, k);
        else
          return this.curve._wnafMul(this, k);
      };
      Point.prototype.mulAdd = function mulAdd(k1, p, k2) {
        return this.curve._wnafMulAdd(1, [this, p], [k1, k2], 2, false);
      };
      Point.prototype.jmulAdd = function jmulAdd(k1, p, k2) {
        return this.curve._wnafMulAdd(1, [this, p], [k1, k2], 2, true);
      };
      Point.prototype.normalize = function normalize() {
        if (this.zOne)
          return this;
        var zi = this.z.redInvm();
        this.x = this.x.redMul(zi);
        this.y = this.y.redMul(zi);
        if (this.t)
          this.t = this.t.redMul(zi);
        this.z = this.curve.one;
        this.zOne = true;
        return this;
      };
      Point.prototype.neg = function neg() {
        return this.curve.point(
            this.x.redNeg(),
            this.y,
            this.z,
            this.t && this.t.redNeg()
        );
      };
      Point.prototype.getX = function getX() {
        this.normalize();
        return this.x.fromRed();
      };
      Point.prototype.getY = function getY() {
        this.normalize();
        return this.y.fromRed();
      };
      Point.prototype.eq = function eq(other) {
        return this === other || this.getX().cmp(other.getX()) === 0 && this.getY().cmp(other.getY()) === 0;
      };
      Point.prototype.eqXToP = function eqXToP(x) {
        var rx = x.toRed(this.curve.red).redMul(this.z);
        if (this.x.cmp(rx) === 0)
          return true;
        var xc = x.clone();
        var t = this.curve.redN.redMul(this.z);
        for (; ; ) {
          xc.iadd(this.curve.n);
          if (xc.cmp(this.curve.p) >= 0)
            return false;
          rx.redIAdd(t);
          if (this.x.cmp(rx) === 0)
            return true;
        }
      };
      Point.prototype.toP = Point.prototype.normalize;
      Point.prototype.mixedAdd = Point.prototype.add;
    }
  });

  // node_modules/elliptic/lib/elliptic/curve/index.js
  var require_curve = __commonJS({
    "node_modules/elliptic/lib/elliptic/curve/index.js"(exports) {
      "use strict";
      var curve = exports;
      curve.base = require_base();
      curve.short = require_short();
      curve.mont = require_mont();
      curve.edwards = require_edwards();
    }
  });

  // node_modules/hash.js/lib/hash/utils.js
  var require_utils3 = __commonJS({
    "node_modules/hash.js/lib/hash/utils.js"(exports) {
      "use strict";
      var assert2 = require_minimalistic_assert();
      var inherits = require_inherits_browser();
      exports.inherits = inherits;
      function isSurrogatePair(msg, i) {
        if ((msg.charCodeAt(i) & 64512) !== 55296) {
          return false;
        }
        if (i < 0 || i + 1 >= msg.length) {
          return false;
        }
        return (msg.charCodeAt(i + 1) & 64512) === 56320;
      }
      function toArray2(msg, enc) {
        if (Array.isArray(msg))
          return msg.slice();
        if (!msg)
          return [];
        var res = [];
        if (typeof msg === "string") {
          if (!enc) {
            var p = 0;
            for (var i = 0; i < msg.length; i++) {
              var c = msg.charCodeAt(i);
              if (c < 128) {
                res[p++] = c;
              } else if (c < 2048) {
                res[p++] = c >> 6 | 192;
                res[p++] = c & 63 | 128;
              } else if (isSurrogatePair(msg, i)) {
                c = 65536 + ((c & 1023) << 10) + (msg.charCodeAt(++i) & 1023);
                res[p++] = c >> 18 | 240;
                res[p++] = c >> 12 & 63 | 128;
                res[p++] = c >> 6 & 63 | 128;
                res[p++] = c & 63 | 128;
              } else {
                res[p++] = c >> 12 | 224;
                res[p++] = c >> 6 & 63 | 128;
                res[p++] = c & 63 | 128;
              }
            }
          } else if (enc === "hex") {
            msg = msg.replace(/[^a-z0-9]+/ig, "");
            if (msg.length % 2 !== 0)
              msg = "0" + msg;
            for (i = 0; i < msg.length; i += 2)
              res.push(parseInt(msg[i] + msg[i + 1], 16));
          }
        } else {
          for (i = 0; i < msg.length; i++)
            res[i] = msg[i] | 0;
        }
        return res;
      }
      exports.toArray = toArray2;
      function toHex(msg) {
        var res = "";
        for (var i = 0; i < msg.length; i++)
          res += zero2(msg[i].toString(16));
        return res;
      }
      exports.toHex = toHex;
      function htonl(w) {
        var res = w >>> 24 | w >>> 8 & 65280 | w << 8 & 16711680 | (w & 255) << 24;
        return res >>> 0;
      }
      exports.htonl = htonl;
      function toHex32(msg, endian) {
        var res = "";
        for (var i = 0; i < msg.length; i++) {
          var w = msg[i];
          if (endian === "little")
            w = htonl(w);
          res += zero8(w.toString(16));
        }
        return res;
      }
      exports.toHex32 = toHex32;
      function zero2(word) {
        if (word.length === 1)
          return "0" + word;
        else
          return word;
      }
      exports.zero2 = zero2;
      function zero8(word) {
        if (word.length === 7)
          return "0" + word;
        else if (word.length === 6)
          return "00" + word;
        else if (word.length === 5)
          return "000" + word;
        else if (word.length === 4)
          return "0000" + word;
        else if (word.length === 3)
          return "00000" + word;
        else if (word.length === 2)
          return "000000" + word;
        else if (word.length === 1)
          return "0000000" + word;
        else
          return word;
      }
      exports.zero8 = zero8;
      function join32(msg, start, end, endian) {
        var len = end - start;
        assert2(len % 4 === 0);
        var res = new Array(len / 4);
        for (var i = 0, k = start; i < res.length; i++, k += 4) {
          var w;
          if (endian === "big")
            w = msg[k] << 24 | msg[k + 1] << 16 | msg[k + 2] << 8 | msg[k + 3];
          else
            w = msg[k + 3] << 24 | msg[k + 2] << 16 | msg[k + 1] << 8 | msg[k];
          res[i] = w >>> 0;
        }
        return res;
      }
      exports.join32 = join32;
      function split32(msg, endian) {
        var res = new Array(msg.length * 4);
        for (var i = 0, k = 0; i < msg.length; i++, k += 4) {
          var m = msg[i];
          if (endian === "big") {
            res[k] = m >>> 24;
            res[k + 1] = m >>> 16 & 255;
            res[k + 2] = m >>> 8 & 255;
            res[k + 3] = m & 255;
          } else {
            res[k + 3] = m >>> 24;
            res[k + 2] = m >>> 16 & 255;
            res[k + 1] = m >>> 8 & 255;
            res[k] = m & 255;
          }
        }
        return res;
      }
      exports.split32 = split32;
      function rotr32(w, b) {
        return w >>> b | w << 32 - b;
      }
      exports.rotr32 = rotr32;
      function rotl32(w, b) {
        return w << b | w >>> 32 - b;
      }
      exports.rotl32 = rotl32;
      function sum32(a, b) {
        return a + b >>> 0;
      }
      exports.sum32 = sum32;
      function sum32_3(a, b, c) {
        return a + b + c >>> 0;
      }
      exports.sum32_3 = sum32_3;
      function sum32_4(a, b, c, d) {
        return a + b + c + d >>> 0;
      }
      exports.sum32_4 = sum32_4;
      function sum32_5(a, b, c, d, e) {
        return a + b + c + d + e >>> 0;
      }
      exports.sum32_5 = sum32_5;
      function sum64(buf2, pos, ah, al) {
        var bh = buf2[pos];
        var bl = buf2[pos + 1];
        var lo = al + bl >>> 0;
        var hi = (lo < al ? 1 : 0) + ah + bh;
        buf2[pos] = hi >>> 0;
        buf2[pos + 1] = lo;
      }
      exports.sum64 = sum64;
      function sum64_hi(ah, al, bh, bl) {
        var lo = al + bl >>> 0;
        var hi = (lo < al ? 1 : 0) + ah + bh;
        return hi >>> 0;
      }
      exports.sum64_hi = sum64_hi;
      function sum64_lo(ah, al, bh, bl) {
        var lo = al + bl;
        return lo >>> 0;
      }
      exports.sum64_lo = sum64_lo;
      function sum64_4_hi(ah, al, bh, bl, ch, cl, dh, dl) {
        var carry = 0;
        var lo = al;
        lo = lo + bl >>> 0;
        carry += lo < al ? 1 : 0;
        lo = lo + cl >>> 0;
        carry += lo < cl ? 1 : 0;
        lo = lo + dl >>> 0;
        carry += lo < dl ? 1 : 0;
        var hi = ah + bh + ch + dh + carry;
        return hi >>> 0;
      }
      exports.sum64_4_hi = sum64_4_hi;
      function sum64_4_lo(ah, al, bh, bl, ch, cl, dh, dl) {
        var lo = al + bl + cl + dl;
        return lo >>> 0;
      }
      exports.sum64_4_lo = sum64_4_lo;
      function sum64_5_hi(ah, al, bh, bl, ch, cl, dh, dl, eh, el) {
        var carry = 0;
        var lo = al;
        lo = lo + bl >>> 0;
        carry += lo < al ? 1 : 0;
        lo = lo + cl >>> 0;
        carry += lo < cl ? 1 : 0;
        lo = lo + dl >>> 0;
        carry += lo < dl ? 1 : 0;
        lo = lo + el >>> 0;
        carry += lo < el ? 1 : 0;
        var hi = ah + bh + ch + dh + eh + carry;
        return hi >>> 0;
      }
      exports.sum64_5_hi = sum64_5_hi;
      function sum64_5_lo(ah, al, bh, bl, ch, cl, dh, dl, eh, el) {
        var lo = al + bl + cl + dl + el;
        return lo >>> 0;
      }
      exports.sum64_5_lo = sum64_5_lo;
      function rotr64_hi(ah, al, num) {
        var r = al << 32 - num | ah >>> num;
        return r >>> 0;
      }
      exports.rotr64_hi = rotr64_hi;
      function rotr64_lo(ah, al, num) {
        var r = ah << 32 - num | al >>> num;
        return r >>> 0;
      }
      exports.rotr64_lo = rotr64_lo;
      function shr64_hi(ah, al, num) {
        return ah >>> num;
      }
      exports.shr64_hi = shr64_hi;
      function shr64_lo(ah, al, num) {
        var r = ah << 32 - num | al >>> num;
        return r >>> 0;
      }
      exports.shr64_lo = shr64_lo;
    }
  });

  // node_modules/hash.js/lib/hash/common.js
  var require_common = __commonJS({
    "node_modules/hash.js/lib/hash/common.js"(exports) {
      "use strict";
      var utils = require_utils3();
      var assert2 = require_minimalistic_assert();
      function BlockHash() {
        this.pending = null;
        this.pendingTotal = 0;
        this.blockSize = this.constructor.blockSize;
        this.outSize = this.constructor.outSize;
        this.hmacStrength = this.constructor.hmacStrength;
        this.padLength = this.constructor.padLength / 8;
        this.endian = "big";
        this._delta8 = this.blockSize / 8;
        this._delta32 = this.blockSize / 32;
      }
      exports.BlockHash = BlockHash;
      BlockHash.prototype.update = function update(msg, enc) {
        msg = utils.toArray(msg, enc);
        if (!this.pending)
          this.pending = msg;
        else
          this.pending = this.pending.concat(msg);
        this.pendingTotal += msg.length;
        if (this.pending.length >= this._delta8) {
          msg = this.pending;
          var r = msg.length % this._delta8;
          this.pending = msg.slice(msg.length - r, msg.length);
          if (this.pending.length === 0)
            this.pending = null;
          msg = utils.join32(msg, 0, msg.length - r, this.endian);
          for (var i = 0; i < msg.length; i += this._delta32)
            this._update(msg, i, i + this._delta32);
        }
        return this;
      };
      BlockHash.prototype.digest = function digest3(enc) {
        this.update(this._pad());
        assert2(this.pending === null);
        return this._digest(enc);
      };
      BlockHash.prototype._pad = function pad() {
        var len = this.pendingTotal;
        var bytes2 = this._delta8;
        var k = bytes2 - (len + this.padLength) % bytes2;
        var res = new Array(k + this.padLength);
        res[0] = 128;
        for (var i = 1; i < k; i++)
          res[i] = 0;
        len <<= 3;
        if (this.endian === "big") {
          for (var t = 8; t < this.padLength; t++)
            res[i++] = 0;
          res[i++] = 0;
          res[i++] = 0;
          res[i++] = 0;
          res[i++] = 0;
          res[i++] = len >>> 24 & 255;
          res[i++] = len >>> 16 & 255;
          res[i++] = len >>> 8 & 255;
          res[i++] = len & 255;
        } else {
          res[i++] = len & 255;
          res[i++] = len >>> 8 & 255;
          res[i++] = len >>> 16 & 255;
          res[i++] = len >>> 24 & 255;
          res[i++] = 0;
          res[i++] = 0;
          res[i++] = 0;
          res[i++] = 0;
          for (t = 8; t < this.padLength; t++)
            res[i++] = 0;
        }
        return res;
      };
    }
  });

  // node_modules/hash.js/lib/hash/sha/common.js
  var require_common2 = __commonJS({
    "node_modules/hash.js/lib/hash/sha/common.js"(exports) {
      "use strict";
      var utils = require_utils3();
      var rotr32 = utils.rotr32;
      function ft_1(s, x, y, z) {
        if (s === 0)
          return ch32(x, y, z);
        if (s === 1 || s === 3)
          return p32(x, y, z);
        if (s === 2)
          return maj32(x, y, z);
      }
      exports.ft_1 = ft_1;
      function ch32(x, y, z) {
        return x & y ^ ~x & z;
      }
      exports.ch32 = ch32;
      function maj32(x, y, z) {
        return x & y ^ x & z ^ y & z;
      }
      exports.maj32 = maj32;
      function p32(x, y, z) {
        return x ^ y ^ z;
      }
      exports.p32 = p32;
      function s0_256(x) {
        return rotr32(x, 2) ^ rotr32(x, 13) ^ rotr32(x, 22);
      }
      exports.s0_256 = s0_256;
      function s1_256(x) {
        return rotr32(x, 6) ^ rotr32(x, 11) ^ rotr32(x, 25);
      }
      exports.s1_256 = s1_256;
      function g0_256(x) {
        return rotr32(x, 7) ^ rotr32(x, 18) ^ x >>> 3;
      }
      exports.g0_256 = g0_256;
      function g1_256(x) {
        return rotr32(x, 17) ^ rotr32(x, 19) ^ x >>> 10;
      }
      exports.g1_256 = g1_256;
    }
  });

  // node_modules/hash.js/lib/hash/sha/1.js
  var require__ = __commonJS({
    "node_modules/hash.js/lib/hash/sha/1.js"(exports, module) {
      "use strict";
      var utils = require_utils3();
      var common = require_common();
      var shaCommon = require_common2();
      var rotl32 = utils.rotl32;
      var sum32 = utils.sum32;
      var sum32_5 = utils.sum32_5;
      var ft_1 = shaCommon.ft_1;
      var BlockHash = common.BlockHash;
      var sha1_K = [
        1518500249,
        1859775393,
        2400959708,
        3395469782
      ];
      function SHA1() {
        if (!(this instanceof SHA1))
          return new SHA1();
        BlockHash.call(this);
        this.h = [
          1732584193,
          4023233417,
          2562383102,
          271733878,
          3285377520
        ];
        this.W = new Array(80);
      }
      utils.inherits(SHA1, BlockHash);
      module.exports = SHA1;
      SHA1.blockSize = 512;
      SHA1.outSize = 160;
      SHA1.hmacStrength = 80;
      SHA1.padLength = 64;
      SHA1.prototype._update = function _update(msg, start) {
        var W = this.W;
        for (var i = 0; i < 16; i++)
          W[i] = msg[start + i];
        for (; i < W.length; i++)
          W[i] = rotl32(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);
        var a = this.h[0];
        var b = this.h[1];
        var c = this.h[2];
        var d = this.h[3];
        var e = this.h[4];
        for (i = 0; i < W.length; i++) {
          var s = ~~(i / 20);
          var t = sum32_5(rotl32(a, 5), ft_1(s, b, c, d), e, W[i], sha1_K[s]);
          e = d;
          d = c;
          c = rotl32(b, 30);
          b = a;
          a = t;
        }
        this.h[0] = sum32(this.h[0], a);
        this.h[1] = sum32(this.h[1], b);
        this.h[2] = sum32(this.h[2], c);
        this.h[3] = sum32(this.h[3], d);
        this.h[4] = sum32(this.h[4], e);
      };
      SHA1.prototype._digest = function digest3(enc) {
        if (enc === "hex")
          return utils.toHex32(this.h, "big");
        else
          return utils.split32(this.h, "big");
      };
    }
  });

  // node_modules/hash.js/lib/hash/sha/256.js
  var require__2 = __commonJS({
    "node_modules/hash.js/lib/hash/sha/256.js"(exports, module) {
      "use strict";
      var utils = require_utils3();
      var common = require_common();
      var shaCommon = require_common2();
      var assert2 = require_minimalistic_assert();
      var sum32 = utils.sum32;
      var sum32_4 = utils.sum32_4;
      var sum32_5 = utils.sum32_5;
      var ch32 = shaCommon.ch32;
      var maj32 = shaCommon.maj32;
      var s0_256 = shaCommon.s0_256;
      var s1_256 = shaCommon.s1_256;
      var g0_256 = shaCommon.g0_256;
      var g1_256 = shaCommon.g1_256;
      var BlockHash = common.BlockHash;
      var sha256_K = [
        1116352408,
        1899447441,
        3049323471,
        3921009573,
        961987163,
        1508970993,
        2453635748,
        2870763221,
        3624381080,
        310598401,
        607225278,
        1426881987,
        1925078388,
        2162078206,
        2614888103,
        3248222580,
        3835390401,
        4022224774,
        264347078,
        604807628,
        770255983,
        1249150122,
        1555081692,
        1996064986,
        2554220882,
        2821834349,
        2952996808,
        3210313671,
        3336571891,
        3584528711,
        113926993,
        338241895,
        666307205,
        773529912,
        1294757372,
        1396182291,
        1695183700,
        1986661051,
        2177026350,
        2456956037,
        2730485921,
        2820302411,
        3259730800,
        3345764771,
        3516065817,
        3600352804,
        4094571909,
        275423344,
        430227734,
        506948616,
        659060556,
        883997877,
        958139571,
        1322822218,
        1537002063,
        1747873779,
        1955562222,
        2024104815,
        2227730452,
        2361852424,
        2428436474,
        2756734187,
        3204031479,
        3329325298
      ];
      function SHA2562() {
        if (!(this instanceof SHA2562))
          return new SHA2562();
        BlockHash.call(this);
        this.h = [
          1779033703,
          3144134277,
          1013904242,
          2773480762,
          1359893119,
          2600822924,
          528734635,
          1541459225
        ];
        this.k = sha256_K;
        this.W = new Array(64);
      }
      utils.inherits(SHA2562, BlockHash);
      module.exports = SHA2562;
      SHA2562.blockSize = 512;
      SHA2562.outSize = 256;
      SHA2562.hmacStrength = 192;
      SHA2562.padLength = 64;
      SHA2562.prototype._update = function _update(msg, start) {
        var W = this.W;
        for (var i = 0; i < 16; i++)
          W[i] = msg[start + i];
        for (; i < W.length; i++)
          W[i] = sum32_4(g1_256(W[i - 2]), W[i - 7], g0_256(W[i - 15]), W[i - 16]);
        var a = this.h[0];
        var b = this.h[1];
        var c = this.h[2];
        var d = this.h[3];
        var e = this.h[4];
        var f = this.h[5];
        var g = this.h[6];
        var h = this.h[7];
        assert2(this.k.length === W.length);
        for (i = 0; i < W.length; i++) {
          var T1 = sum32_5(h, s1_256(e), ch32(e, f, g), this.k[i], W[i]);
          var T2 = sum32(s0_256(a), maj32(a, b, c));
          h = g;
          g = f;
          f = e;
          e = sum32(d, T1);
          d = c;
          c = b;
          b = a;
          a = sum32(T1, T2);
        }
        this.h[0] = sum32(this.h[0], a);
        this.h[1] = sum32(this.h[1], b);
        this.h[2] = sum32(this.h[2], c);
        this.h[3] = sum32(this.h[3], d);
        this.h[4] = sum32(this.h[4], e);
        this.h[5] = sum32(this.h[5], f);
        this.h[6] = sum32(this.h[6], g);
        this.h[7] = sum32(this.h[7], h);
      };
      SHA2562.prototype._digest = function digest3(enc) {
        if (enc === "hex")
          return utils.toHex32(this.h, "big");
        else
          return utils.split32(this.h, "big");
      };
    }
  });

  // node_modules/hash.js/lib/hash/sha/224.js
  var require__3 = __commonJS({
    "node_modules/hash.js/lib/hash/sha/224.js"(exports, module) {
      "use strict";
      var utils = require_utils3();
      var SHA2562 = require__2();
      function SHA2242() {
        if (!(this instanceof SHA2242))
          return new SHA2242();
        SHA2562.call(this);
        this.h = [
          3238371032,
          914150663,
          812702999,
          4144912697,
          4290775857,
          1750603025,
          1694076839,
          3204075428
        ];
      }
      utils.inherits(SHA2242, SHA2562);
      module.exports = SHA2242;
      SHA2242.blockSize = 512;
      SHA2242.outSize = 224;
      SHA2242.hmacStrength = 192;
      SHA2242.padLength = 64;
      SHA2242.prototype._digest = function digest3(enc) {
        if (enc === "hex")
          return utils.toHex32(this.h.slice(0, 7), "big");
        else
          return utils.split32(this.h.slice(0, 7), "big");
      };
    }
  });

  // node_modules/hash.js/lib/hash/sha/512.js
  var require__4 = __commonJS({
    "node_modules/hash.js/lib/hash/sha/512.js"(exports, module) {
      "use strict";
      var utils = require_utils3();
      var common = require_common();
      var assert2 = require_minimalistic_assert();
      var rotr64_hi = utils.rotr64_hi;
      var rotr64_lo = utils.rotr64_lo;
      var shr64_hi = utils.shr64_hi;
      var shr64_lo = utils.shr64_lo;
      var sum64 = utils.sum64;
      var sum64_hi = utils.sum64_hi;
      var sum64_lo = utils.sum64_lo;
      var sum64_4_hi = utils.sum64_4_hi;
      var sum64_4_lo = utils.sum64_4_lo;
      var sum64_5_hi = utils.sum64_5_hi;
      var sum64_5_lo = utils.sum64_5_lo;
      var BlockHash = common.BlockHash;
      var sha512_K = [
        1116352408,
        3609767458,
        1899447441,
        602891725,
        3049323471,
        3964484399,
        3921009573,
        2173295548,
        961987163,
        4081628472,
        1508970993,
        3053834265,
        2453635748,
        2937671579,
        2870763221,
        3664609560,
        3624381080,
        2734883394,
        310598401,
        1164996542,
        607225278,
        1323610764,
        1426881987,
        3590304994,
        1925078388,
        4068182383,
        2162078206,
        991336113,
        2614888103,
        633803317,
        3248222580,
        3479774868,
        3835390401,
        2666613458,
        4022224774,
        944711139,
        264347078,
        2341262773,
        604807628,
        2007800933,
        770255983,
        1495990901,
        1249150122,
        1856431235,
        1555081692,
        3175218132,
        1996064986,
        2198950837,
        2554220882,
        3999719339,
        2821834349,
        766784016,
        2952996808,
        2566594879,
        3210313671,
        3203337956,
        3336571891,
        1034457026,
        3584528711,
        2466948901,
        113926993,
        3758326383,
        338241895,
        168717936,
        666307205,
        1188179964,
        773529912,
        1546045734,
        1294757372,
        1522805485,
        1396182291,
        2643833823,
        1695183700,
        2343527390,
        1986661051,
        1014477480,
        2177026350,
        1206759142,
        2456956037,
        344077627,
        2730485921,
        1290863460,
        2820302411,
        3158454273,
        3259730800,
        3505952657,
        3345764771,
        106217008,
        3516065817,
        3606008344,
        3600352804,
        1432725776,
        4094571909,
        1467031594,
        275423344,
        851169720,
        430227734,
        3100823752,
        506948616,
        1363258195,
        659060556,
        3750685593,
        883997877,
        3785050280,
        958139571,
        3318307427,
        1322822218,
        3812723403,
        1537002063,
        2003034995,
        1747873779,
        3602036899,
        1955562222,
        1575990012,
        2024104815,
        1125592928,
        2227730452,
        2716904306,
        2361852424,
        442776044,
        2428436474,
        593698344,
        2756734187,
        3733110249,
        3204031479,
        2999351573,
        3329325298,
        3815920427,
        3391569614,
        3928383900,
        3515267271,
        566280711,
        3940187606,
        3454069534,
        4118630271,
        4000239992,
        116418474,
        1914138554,
        174292421,
        2731055270,
        289380356,
        3203993006,
        460393269,
        320620315,
        685471733,
        587496836,
        852142971,
        1086792851,
        1017036298,
        365543100,
        1126000580,
        2618297676,
        1288033470,
        3409855158,
        1501505948,
        4234509866,
        1607167915,
        987167468,
        1816402316,
        1246189591
      ];
      function SHA5122() {
        if (!(this instanceof SHA5122))
          return new SHA5122();
        BlockHash.call(this);
        this.h = [
          1779033703,
          4089235720,
          3144134277,
          2227873595,
          1013904242,
          4271175723,
          2773480762,
          1595750129,
          1359893119,
          2917565137,
          2600822924,
          725511199,
          528734635,
          4215389547,
          1541459225,
          327033209
        ];
        this.k = sha512_K;
        this.W = new Array(160);
      }
      utils.inherits(SHA5122, BlockHash);
      module.exports = SHA5122;
      SHA5122.blockSize = 1024;
      SHA5122.outSize = 512;
      SHA5122.hmacStrength = 192;
      SHA5122.padLength = 128;
      SHA5122.prototype._prepareBlock = function _prepareBlock(msg, start) {
        var W = this.W;
        for (var i = 0; i < 32; i++)
          W[i] = msg[start + i];
        for (; i < W.length; i += 2) {
          var c0_hi = g1_512_hi(W[i - 4], W[i - 3]);
          var c0_lo = g1_512_lo(W[i - 4], W[i - 3]);
          var c1_hi = W[i - 14];
          var c1_lo = W[i - 13];
          var c2_hi = g0_512_hi(W[i - 30], W[i - 29]);
          var c2_lo = g0_512_lo(W[i - 30], W[i - 29]);
          var c3_hi = W[i - 32];
          var c3_lo = W[i - 31];
          W[i] = sum64_4_hi(
              c0_hi,
              c0_lo,
              c1_hi,
              c1_lo,
              c2_hi,
              c2_lo,
              c3_hi,
              c3_lo
          );
          W[i + 1] = sum64_4_lo(
              c0_hi,
              c0_lo,
              c1_hi,
              c1_lo,
              c2_hi,
              c2_lo,
              c3_hi,
              c3_lo
          );
        }
      };
      SHA5122.prototype._update = function _update(msg, start) {
        this._prepareBlock(msg, start);
        var W = this.W;
        var ah = this.h[0];
        var al = this.h[1];
        var bh = this.h[2];
        var bl = this.h[3];
        var ch = this.h[4];
        var cl = this.h[5];
        var dh = this.h[6];
        var dl = this.h[7];
        var eh = this.h[8];
        var el = this.h[9];
        var fh = this.h[10];
        var fl = this.h[11];
        var gh = this.h[12];
        var gl = this.h[13];
        var hh = this.h[14];
        var hl = this.h[15];
        assert2(this.k.length === W.length);
        for (var i = 0; i < W.length; i += 2) {
          var c0_hi = hh;
          var c0_lo = hl;
          var c1_hi = s1_512_hi(eh, el);
          var c1_lo = s1_512_lo(eh, el);
          var c2_hi = ch64_hi(eh, el, fh, fl, gh, gl);
          var c2_lo = ch64_lo(eh, el, fh, fl, gh, gl);
          var c3_hi = this.k[i];
          var c3_lo = this.k[i + 1];
          var c4_hi = W[i];
          var c4_lo = W[i + 1];
          var T1_hi = sum64_5_hi(
              c0_hi,
              c0_lo,
              c1_hi,
              c1_lo,
              c2_hi,
              c2_lo,
              c3_hi,
              c3_lo,
              c4_hi,
              c4_lo
          );
          var T1_lo = sum64_5_lo(
              c0_hi,
              c0_lo,
              c1_hi,
              c1_lo,
              c2_hi,
              c2_lo,
              c3_hi,
              c3_lo,
              c4_hi,
              c4_lo
          );
          c0_hi = s0_512_hi(ah, al);
          c0_lo = s0_512_lo(ah, al);
          c1_hi = maj64_hi(ah, al, bh, bl, ch, cl);
          c1_lo = maj64_lo(ah, al, bh, bl, ch, cl);
          var T2_hi = sum64_hi(c0_hi, c0_lo, c1_hi, c1_lo);
          var T2_lo = sum64_lo(c0_hi, c0_lo, c1_hi, c1_lo);
          hh = gh;
          hl = gl;
          gh = fh;
          gl = fl;
          fh = eh;
          fl = el;
          eh = sum64_hi(dh, dl, T1_hi, T1_lo);
          el = sum64_lo(dl, dl, T1_hi, T1_lo);
          dh = ch;
          dl = cl;
          ch = bh;
          cl = bl;
          bh = ah;
          bl = al;
          ah = sum64_hi(T1_hi, T1_lo, T2_hi, T2_lo);
          al = sum64_lo(T1_hi, T1_lo, T2_hi, T2_lo);
        }
        sum64(this.h, 0, ah, al);
        sum64(this.h, 2, bh, bl);
        sum64(this.h, 4, ch, cl);
        sum64(this.h, 6, dh, dl);
        sum64(this.h, 8, eh, el);
        sum64(this.h, 10, fh, fl);
        sum64(this.h, 12, gh, gl);
        sum64(this.h, 14, hh, hl);
      };
      SHA5122.prototype._digest = function digest3(enc) {
        if (enc === "hex")
          return utils.toHex32(this.h, "big");
        else
          return utils.split32(this.h, "big");
      };
      function ch64_hi(xh, xl, yh, yl, zh) {
        var r = xh & yh ^ ~xh & zh;
        if (r < 0)
          r += 4294967296;
        return r;
      }
      function ch64_lo(xh, xl, yh, yl, zh, zl) {
        var r = xl & yl ^ ~xl & zl;
        if (r < 0)
          r += 4294967296;
        return r;
      }
      function maj64_hi(xh, xl, yh, yl, zh) {
        var r = xh & yh ^ xh & zh ^ yh & zh;
        if (r < 0)
          r += 4294967296;
        return r;
      }
      function maj64_lo(xh, xl, yh, yl, zh, zl) {
        var r = xl & yl ^ xl & zl ^ yl & zl;
        if (r < 0)
          r += 4294967296;
        return r;
      }
      function s0_512_hi(xh, xl) {
        var c0_hi = rotr64_hi(xh, xl, 28);
        var c1_hi = rotr64_hi(xl, xh, 2);
        var c2_hi = rotr64_hi(xl, xh, 7);
        var r = c0_hi ^ c1_hi ^ c2_hi;
        if (r < 0)
          r += 4294967296;
        return r;
      }
      function s0_512_lo(xh, xl) {
        var c0_lo = rotr64_lo(xh, xl, 28);
        var c1_lo = rotr64_lo(xl, xh, 2);
        var c2_lo = rotr64_lo(xl, xh, 7);
        var r = c0_lo ^ c1_lo ^ c2_lo;
        if (r < 0)
          r += 4294967296;
        return r;
      }
      function s1_512_hi(xh, xl) {
        var c0_hi = rotr64_hi(xh, xl, 14);
        var c1_hi = rotr64_hi(xh, xl, 18);
        var c2_hi = rotr64_hi(xl, xh, 9);
        var r = c0_hi ^ c1_hi ^ c2_hi;
        if (r < 0)
          r += 4294967296;
        return r;
      }
      function s1_512_lo(xh, xl) {
        var c0_lo = rotr64_lo(xh, xl, 14);
        var c1_lo = rotr64_lo(xh, xl, 18);
        var c2_lo = rotr64_lo(xl, xh, 9);
        var r = c0_lo ^ c1_lo ^ c2_lo;
        if (r < 0)
          r += 4294967296;
        return r;
      }
      function g0_512_hi(xh, xl) {
        var c0_hi = rotr64_hi(xh, xl, 1);
        var c1_hi = rotr64_hi(xh, xl, 8);
        var c2_hi = shr64_hi(xh, xl, 7);
        var r = c0_hi ^ c1_hi ^ c2_hi;
        if (r < 0)
          r += 4294967296;
        return r;
      }
      function g0_512_lo(xh, xl) {
        var c0_lo = rotr64_lo(xh, xl, 1);
        var c1_lo = rotr64_lo(xh, xl, 8);
        var c2_lo = shr64_lo(xh, xl, 7);
        var r = c0_lo ^ c1_lo ^ c2_lo;
        if (r < 0)
          r += 4294967296;
        return r;
      }
      function g1_512_hi(xh, xl) {
        var c0_hi = rotr64_hi(xh, xl, 19);
        var c1_hi = rotr64_hi(xl, xh, 29);
        var c2_hi = shr64_hi(xh, xl, 6);
        var r = c0_hi ^ c1_hi ^ c2_hi;
        if (r < 0)
          r += 4294967296;
        return r;
      }
      function g1_512_lo(xh, xl) {
        var c0_lo = rotr64_lo(xh, xl, 19);
        var c1_lo = rotr64_lo(xl, xh, 29);
        var c2_lo = shr64_lo(xh, xl, 6);
        var r = c0_lo ^ c1_lo ^ c2_lo;
        if (r < 0)
          r += 4294967296;
        return r;
      }
    }
  });

  // node_modules/hash.js/lib/hash/sha/384.js
  var require__5 = __commonJS({
    "node_modules/hash.js/lib/hash/sha/384.js"(exports, module) {
      "use strict";
      var utils = require_utils3();
      var SHA5122 = require__4();
      function SHA3842() {
        if (!(this instanceof SHA3842))
          return new SHA3842();
        SHA5122.call(this);
        this.h = [
          3418070365,
          3238371032,
          1654270250,
          914150663,
          2438529370,
          812702999,
          355462360,
          4144912697,
          1731405415,
          4290775857,
          2394180231,
          1750603025,
          3675008525,
          1694076839,
          1203062813,
          3204075428
        ];
      }
      utils.inherits(SHA3842, SHA5122);
      module.exports = SHA3842;
      SHA3842.blockSize = 1024;
      SHA3842.outSize = 384;
      SHA3842.hmacStrength = 192;
      SHA3842.padLength = 128;
      SHA3842.prototype._digest = function digest3(enc) {
        if (enc === "hex")
          return utils.toHex32(this.h.slice(0, 12), "big");
        else
          return utils.split32(this.h.slice(0, 12), "big");
      };
    }
  });

  // node_modules/hash.js/lib/hash/sha.js
  var require_sha = __commonJS({
    "node_modules/hash.js/lib/hash/sha.js"(exports) {
      "use strict";
      exports.sha1 = require__();
      exports.sha224 = require__3();
      exports.sha256 = require__2();
      exports.sha384 = require__5();
      exports.sha512 = require__4();
    }
  });

  // node_modules/hash.js/lib/hash/ripemd.js
  var require_ripemd = __commonJS({
    "node_modules/hash.js/lib/hash/ripemd.js"(exports) {
      "use strict";
      var utils = require_utils3();
      var common = require_common();
      var rotl32 = utils.rotl32;
      var sum32 = utils.sum32;
      var sum32_3 = utils.sum32_3;
      var sum32_4 = utils.sum32_4;
      var BlockHash = common.BlockHash;
      function RIPEMD160() {
        if (!(this instanceof RIPEMD160))
          return new RIPEMD160();
        BlockHash.call(this);
        this.h = [1732584193, 4023233417, 2562383102, 271733878, 3285377520];
        this.endian = "little";
      }
      utils.inherits(RIPEMD160, BlockHash);
      exports.ripemd160 = RIPEMD160;
      RIPEMD160.blockSize = 512;
      RIPEMD160.outSize = 160;
      RIPEMD160.hmacStrength = 192;
      RIPEMD160.padLength = 64;
      RIPEMD160.prototype._update = function update(msg, start) {
        var A = this.h[0];
        var B = this.h[1];
        var C = this.h[2];
        var D = this.h[3];
        var E = this.h[4];
        var Ah = A;
        var Bh = B;
        var Ch = C;
        var Dh = D;
        var Eh = E;
        for (var j = 0; j < 80; j++) {
          var T = sum32(
              rotl32(
                  sum32_4(A, f(j, B, C, D), msg[r[j] + start], K(j)),
                  s[j]
              ),
              E
          );
          A = E;
          E = D;
          D = rotl32(C, 10);
          C = B;
          B = T;
          T = sum32(
              rotl32(
                  sum32_4(Ah, f(79 - j, Bh, Ch, Dh), msg[rh[j] + start], Kh(j)),
                  sh[j]
              ),
              Eh
          );
          Ah = Eh;
          Eh = Dh;
          Dh = rotl32(Ch, 10);
          Ch = Bh;
          Bh = T;
        }
        T = sum32_3(this.h[1], C, Dh);
        this.h[1] = sum32_3(this.h[2], D, Eh);
        this.h[2] = sum32_3(this.h[3], E, Ah);
        this.h[3] = sum32_3(this.h[4], A, Bh);
        this.h[4] = sum32_3(this.h[0], B, Ch);
        this.h[0] = T;
      };
      RIPEMD160.prototype._digest = function digest3(enc) {
        if (enc === "hex")
          return utils.toHex32(this.h, "little");
        else
          return utils.split32(this.h, "little");
      };
      function f(j, x, y, z) {
        if (j <= 15)
          return x ^ y ^ z;
        else if (j <= 31)
          return x & y | ~x & z;
        else if (j <= 47)
          return (x | ~y) ^ z;
        else if (j <= 63)
          return x & z | y & ~z;
        else
          return x ^ (y | ~z);
      }
      function K(j) {
        if (j <= 15)
          return 0;
        else if (j <= 31)
          return 1518500249;
        else if (j <= 47)
          return 1859775393;
        else if (j <= 63)
          return 2400959708;
        else
          return 2840853838;
      }
      function Kh(j) {
        if (j <= 15)
          return 1352829926;
        else if (j <= 31)
          return 1548603684;
        else if (j <= 47)
          return 1836072691;
        else if (j <= 63)
          return 2053994217;
        else
          return 0;
      }
      var r = [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        7,
        4,
        13,
        1,
        10,
        6,
        15,
        3,
        12,
        0,
        9,
        5,
        2,
        14,
        11,
        8,
        3,
        10,
        14,
        4,
        9,
        15,
        8,
        1,
        2,
        7,
        0,
        6,
        13,
        11,
        5,
        12,
        1,
        9,
        11,
        10,
        0,
        8,
        12,
        4,
        13,
        3,
        7,
        15,
        14,
        5,
        6,
        2,
        4,
        0,
        5,
        9,
        7,
        12,
        2,
        10,
        14,
        1,
        3,
        8,
        11,
        6,
        15,
        13
      ];
      var rh = [
        5,
        14,
        7,
        0,
        9,
        2,
        11,
        4,
        13,
        6,
        15,
        8,
        1,
        10,
        3,
        12,
        6,
        11,
        3,
        7,
        0,
        13,
        5,
        10,
        14,
        15,
        8,
        12,
        4,
        9,
        1,
        2,
        15,
        5,
        1,
        3,
        7,
        14,
        6,
        9,
        11,
        8,
        12,
        2,
        10,
        0,
        4,
        13,
        8,
        6,
        4,
        1,
        3,
        11,
        15,
        0,
        5,
        12,
        2,
        13,
        9,
        7,
        10,
        14,
        12,
        15,
        10,
        4,
        1,
        5,
        8,
        7,
        6,
        2,
        13,
        14,
        0,
        3,
        9,
        11
      ];
      var s = [
        11,
        14,
        15,
        12,
        5,
        8,
        7,
        9,
        11,
        13,
        14,
        15,
        6,
        7,
        9,
        8,
        7,
        6,
        8,
        13,
        11,
        9,
        7,
        15,
        7,
        12,
        15,
        9,
        11,
        7,
        13,
        12,
        11,
        13,
        6,
        7,
        14,
        9,
        13,
        15,
        14,
        8,
        13,
        6,
        5,
        12,
        7,
        5,
        11,
        12,
        14,
        15,
        14,
        15,
        9,
        8,
        9,
        14,
        5,
        6,
        8,
        6,
        5,
        12,
        9,
        15,
        5,
        11,
        6,
        8,
        13,
        12,
        5,
        12,
        13,
        14,
        11,
        8,
        5,
        6
      ];
      var sh = [
        8,
        9,
        9,
        11,
        13,
        15,
        15,
        5,
        7,
        7,
        8,
        11,
        14,
        14,
        12,
        6,
        9,
        13,
        15,
        7,
        12,
        8,
        9,
        11,
        7,
        7,
        12,
        7,
        6,
        15,
        13,
        11,
        9,
        7,
        15,
        11,
        8,
        6,
        6,
        14,
        12,
        13,
        5,
        14,
        13,
        13,
        7,
        5,
        15,
        5,
        8,
        11,
        14,
        14,
        6,
        14,
        6,
        9,
        12,
        9,
        12,
        5,
        15,
        8,
        8,
        5,
        12,
        9,
        12,
        5,
        14,
        6,
        8,
        13,
        6,
        5,
        15,
        13,
        11,
        11
      ];
    }
  });

  // node_modules/hash.js/lib/hash/hmac.js
  var require_hmac = __commonJS({
    "node_modules/hash.js/lib/hash/hmac.js"(exports, module) {
      "use strict";
      var utils = require_utils3();
      var assert2 = require_minimalistic_assert();
      function Hmac(hash3, key, enc) {
        if (!(this instanceof Hmac))
          return new Hmac(hash3, key, enc);
        this.Hash = hash3;
        this.blockSize = hash3.blockSize / 8;
        this.outSize = hash3.outSize / 8;
        this.inner = null;
        this.outer = null;
        this._init(utils.toArray(key, enc));
      }
      module.exports = Hmac;
      Hmac.prototype._init = function init(key) {
        if (key.length > this.blockSize)
          key = new this.Hash().update(key).digest();
        assert2(key.length <= this.blockSize);
        for (var i = key.length; i < this.blockSize; i++)
          key.push(0);
        for (i = 0; i < key.length; i++)
          key[i] ^= 54;
        this.inner = new this.Hash().update(key);
        for (i = 0; i < key.length; i++)
          key[i] ^= 106;
        this.outer = new this.Hash().update(key);
      };
      Hmac.prototype.update = function update(msg, enc) {
        this.inner.update(msg, enc);
        return this;
      };
      Hmac.prototype.digest = function digest3(enc) {
        this.outer.update(this.inner.digest());
        return this.outer.digest(enc);
      };
    }
  });

  // node_modules/hash.js/lib/hash.js
  var require_hash = __commonJS({
    "node_modules/hash.js/lib/hash.js"(exports) {
      var hash3 = exports;
      hash3.utils = require_utils3();
      hash3.common = require_common();
      hash3.sha = require_sha();
      hash3.ripemd = require_ripemd();
      hash3.hmac = require_hmac();
      hash3.sha1 = hash3.sha.sha1;
      hash3.sha256 = hash3.sha.sha256;
      hash3.sha224 = hash3.sha.sha224;
      hash3.sha384 = hash3.sha.sha384;
      hash3.sha512 = hash3.sha.sha512;
      hash3.ripemd160 = hash3.ripemd.ripemd160;
    }
  });

  // node_modules/elliptic/lib/elliptic/precomputed/secp256k1.js
  var require_secp256k1 = __commonJS({
    "node_modules/elliptic/lib/elliptic/precomputed/secp256k1.js"(exports, module) {
      module.exports = {
        doubles: {
          step: 4,
          points: [
            [
              "e60fce93b59e9ec53011aabc21c23e97b2a31369b87a5ae9c44ee89e2a6dec0a",
              "f7e3507399e595929db99f34f57937101296891e44d23f0be1f32cce69616821"
            ],
            [
              "8282263212c609d9ea2a6e3e172de238d8c39cabd5ac1ca10646e23fd5f51508",
              "11f8a8098557dfe45e8256e830b60ace62d613ac2f7b17bed31b6eaff6e26caf"
            ],
            [
              "175e159f728b865a72f99cc6c6fc846de0b93833fd2222ed73fce5b551e5b739",
              "d3506e0d9e3c79eba4ef97a51ff71f5eacb5955add24345c6efa6ffee9fed695"
            ],
            [
              "363d90d447b00c9c99ceac05b6262ee053441c7e55552ffe526bad8f83ff4640",
              "4e273adfc732221953b445397f3363145b9a89008199ecb62003c7f3bee9de9"
            ],
            [
              "8b4b5f165df3c2be8c6244b5b745638843e4a781a15bcd1b69f79a55dffdf80c",
              "4aad0a6f68d308b4b3fbd7813ab0da04f9e336546162ee56b3eff0c65fd4fd36"
            ],
            [
              "723cbaa6e5db996d6bf771c00bd548c7b700dbffa6c0e77bcb6115925232fcda",
              "96e867b5595cc498a921137488824d6e2660a0653779494801dc069d9eb39f5f"
            ],
            [
              "eebfa4d493bebf98ba5feec812c2d3b50947961237a919839a533eca0e7dd7fa",
              "5d9a8ca3970ef0f269ee7edaf178089d9ae4cdc3a711f712ddfd4fdae1de8999"
            ],
            [
              "100f44da696e71672791d0a09b7bde459f1215a29b3c03bfefd7835b39a48db0",
              "cdd9e13192a00b772ec8f3300c090666b7ff4a18ff5195ac0fbd5cd62bc65a09"
            ],
            [
              "e1031be262c7ed1b1dc9227a4a04c017a77f8d4464f3b3852c8acde6e534fd2d",
              "9d7061928940405e6bb6a4176597535af292dd419e1ced79a44f18f29456a00d"
            ],
            [
              "feea6cae46d55b530ac2839f143bd7ec5cf8b266a41d6af52d5e688d9094696d",
              "e57c6b6c97dce1bab06e4e12bf3ecd5c981c8957cc41442d3155debf18090088"
            ],
            [
              "da67a91d91049cdcb367be4be6ffca3cfeed657d808583de33fa978bc1ec6cb1",
              "9bacaa35481642bc41f463f7ec9780e5dec7adc508f740a17e9ea8e27a68be1d"
            ],
            [
              "53904faa0b334cdda6e000935ef22151ec08d0f7bb11069f57545ccc1a37b7c0",
              "5bc087d0bc80106d88c9eccac20d3c1c13999981e14434699dcb096b022771c8"
            ],
            [
              "8e7bcd0bd35983a7719cca7764ca906779b53a043a9b8bcaeff959f43ad86047",
              "10b7770b2a3da4b3940310420ca9514579e88e2e47fd68b3ea10047e8460372a"
            ],
            [
              "385eed34c1cdff21e6d0818689b81bde71a7f4f18397e6690a841e1599c43862",
              "283bebc3e8ea23f56701de19e9ebf4576b304eec2086dc8cc0458fe5542e5453"
            ],
            [
              "6f9d9b803ecf191637c73a4413dfa180fddf84a5947fbc9c606ed86c3fac3a7",
              "7c80c68e603059ba69b8e2a30e45c4d47ea4dd2f5c281002d86890603a842160"
            ],
            [
              "3322d401243c4e2582a2147c104d6ecbf774d163db0f5e5313b7e0e742d0e6bd",
              "56e70797e9664ef5bfb019bc4ddaf9b72805f63ea2873af624f3a2e96c28b2a0"
            ],
            [
              "85672c7d2de0b7da2bd1770d89665868741b3f9af7643397721d74d28134ab83",
              "7c481b9b5b43b2eb6374049bfa62c2e5e77f17fcc5298f44c8e3094f790313a6"
            ],
            [
              "948bf809b1988a46b06c9f1919413b10f9226c60f668832ffd959af60c82a0a",
              "53a562856dcb6646dc6b74c5d1c3418c6d4dff08c97cd2bed4cb7f88d8c8e589"
            ],
            [
              "6260ce7f461801c34f067ce0f02873a8f1b0e44dfc69752accecd819f38fd8e8",
              "bc2da82b6fa5b571a7f09049776a1ef7ecd292238051c198c1a84e95b2b4ae17"
            ],
            [
              "e5037de0afc1d8d43d8348414bbf4103043ec8f575bfdc432953cc8d2037fa2d",
              "4571534baa94d3b5f9f98d09fb990bddbd5f5b03ec481f10e0e5dc841d755bda"
            ],
            [
              "e06372b0f4a207adf5ea905e8f1771b4e7e8dbd1c6a6c5b725866a0ae4fce725",
              "7a908974bce18cfe12a27bb2ad5a488cd7484a7787104870b27034f94eee31dd"
            ],
            [
              "213c7a715cd5d45358d0bbf9dc0ce02204b10bdde2a3f58540ad6908d0559754",
              "4b6dad0b5ae462507013ad06245ba190bb4850f5f36a7eeddff2c27534b458f2"
            ],
            [
              "4e7c272a7af4b34e8dbb9352a5419a87e2838c70adc62cddf0cc3a3b08fbd53c",
              "17749c766c9d0b18e16fd09f6def681b530b9614bff7dd33e0b3941817dcaae6"
            ],
            [
              "fea74e3dbe778b1b10f238ad61686aa5c76e3db2be43057632427e2840fb27b6",
              "6e0568db9b0b13297cf674deccb6af93126b596b973f7b77701d3db7f23cb96f"
            ],
            [
              "76e64113f677cf0e10a2570d599968d31544e179b760432952c02a4417bdde39",
              "c90ddf8dee4e95cf577066d70681f0d35e2a33d2b56d2032b4b1752d1901ac01"
            ],
            [
              "c738c56b03b2abe1e8281baa743f8f9a8f7cc643df26cbee3ab150242bcbb891",
              "893fb578951ad2537f718f2eacbfbbbb82314eef7880cfe917e735d9699a84c3"
            ],
            [
              "d895626548b65b81e264c7637c972877d1d72e5f3a925014372e9f6588f6c14b",
              "febfaa38f2bc7eae728ec60818c340eb03428d632bb067e179363ed75d7d991f"
            ],
            [
              "b8da94032a957518eb0f6433571e8761ceffc73693e84edd49150a564f676e03",
              "2804dfa44805a1e4d7c99cc9762808b092cc584d95ff3b511488e4e74efdf6e7"
            ],
            [
              "e80fea14441fb33a7d8adab9475d7fab2019effb5156a792f1a11778e3c0df5d",
              "eed1de7f638e00771e89768ca3ca94472d155e80af322ea9fcb4291b6ac9ec78"
            ],
            [
              "a301697bdfcd704313ba48e51d567543f2a182031efd6915ddc07bbcc4e16070",
              "7370f91cfb67e4f5081809fa25d40f9b1735dbf7c0a11a130c0d1a041e177ea1"
            ],
            [
              "90ad85b389d6b936463f9d0512678de208cc330b11307fffab7ac63e3fb04ed4",
              "e507a3620a38261affdcbd9427222b839aefabe1582894d991d4d48cb6ef150"
            ],
            [
              "8f68b9d2f63b5f339239c1ad981f162ee88c5678723ea3351b7b444c9ec4c0da",
              "662a9f2dba063986de1d90c2b6be215dbbea2cfe95510bfdf23cbf79501fff82"
            ],
            [
              "e4f3fb0176af85d65ff99ff9198c36091f48e86503681e3e6686fd5053231e11",
              "1e63633ad0ef4f1c1661a6d0ea02b7286cc7e74ec951d1c9822c38576feb73bc"
            ],
            [
              "8c00fa9b18ebf331eb961537a45a4266c7034f2f0d4e1d0716fb6eae20eae29e",
              "efa47267fea521a1a9dc343a3736c974c2fadafa81e36c54e7d2a4c66702414b"
            ],
            [
              "e7a26ce69dd4829f3e10cec0a9e98ed3143d084f308b92c0997fddfc60cb3e41",
              "2a758e300fa7984b471b006a1aafbb18d0a6b2c0420e83e20e8a9421cf2cfd51"
            ],
            [
              "b6459e0ee3662ec8d23540c223bcbdc571cbcb967d79424f3cf29eb3de6b80ef",
              "67c876d06f3e06de1dadf16e5661db3c4b3ae6d48e35b2ff30bf0b61a71ba45"
            ],
            [
              "d68a80c8280bb840793234aa118f06231d6f1fc67e73c5a5deda0f5b496943e8",
              "db8ba9fff4b586d00c4b1f9177b0e28b5b0e7b8f7845295a294c84266b133120"
            ],
            [
              "324aed7df65c804252dc0270907a30b09612aeb973449cea4095980fc28d3d5d",
              "648a365774b61f2ff130c0c35aec1f4f19213b0c7e332843967224af96ab7c84"
            ],
            [
              "4df9c14919cde61f6d51dfdbe5fee5dceec4143ba8d1ca888e8bd373fd054c96",
              "35ec51092d8728050974c23a1d85d4b5d506cdc288490192ebac06cad10d5d"
            ],
            [
              "9c3919a84a474870faed8a9c1cc66021523489054d7f0308cbfc99c8ac1f98cd",
              "ddb84f0f4a4ddd57584f044bf260e641905326f76c64c8e6be7e5e03d4fc599d"
            ],
            [
              "6057170b1dd12fdf8de05f281d8e06bb91e1493a8b91d4cc5a21382120a959e5",
              "9a1af0b26a6a4807add9a2daf71df262465152bc3ee24c65e899be932385a2a8"
            ],
            [
              "a576df8e23a08411421439a4518da31880cef0fba7d4df12b1a6973eecb94266",
              "40a6bf20e76640b2c92b97afe58cd82c432e10a7f514d9f3ee8be11ae1b28ec8"
            ],
            [
              "7778a78c28dec3e30a05fe9629de8c38bb30d1f5cf9a3a208f763889be58ad71",
              "34626d9ab5a5b22ff7098e12f2ff580087b38411ff24ac563b513fc1fd9f43ac"
            ],
            [
              "928955ee637a84463729fd30e7afd2ed5f96274e5ad7e5cb09eda9c06d903ac",
              "c25621003d3f42a827b78a13093a95eeac3d26efa8a8d83fc5180e935bcd091f"
            ],
            [
              "85d0fef3ec6db109399064f3a0e3b2855645b4a907ad354527aae75163d82751",
              "1f03648413a38c0be29d496e582cf5663e8751e96877331582c237a24eb1f962"
            ],
            [
              "ff2b0dce97eece97c1c9b6041798b85dfdfb6d8882da20308f5404824526087e",
              "493d13fef524ba188af4c4dc54d07936c7b7ed6fb90e2ceb2c951e01f0c29907"
            ],
            [
              "827fbbe4b1e880ea9ed2b2e6301b212b57f1ee148cd6dd28780e5e2cf856e241",
              "c60f9c923c727b0b71bef2c67d1d12687ff7a63186903166d605b68baec293ec"
            ],
            [
              "eaa649f21f51bdbae7be4ae34ce6e5217a58fdce7f47f9aa7f3b58fa2120e2b3",
              "be3279ed5bbbb03ac69a80f89879aa5a01a6b965f13f7e59d47a5305ba5ad93d"
            ],
            [
              "e4a42d43c5cf169d9391df6decf42ee541b6d8f0c9a137401e23632dda34d24f",
              "4d9f92e716d1c73526fc99ccfb8ad34ce886eedfa8d8e4f13a7f7131deba9414"
            ],
            [
              "1ec80fef360cbdd954160fadab352b6b92b53576a88fea4947173b9d4300bf19",
              "aeefe93756b5340d2f3a4958a7abbf5e0146e77f6295a07b671cdc1cc107cefd"
            ],
            [
              "146a778c04670c2f91b00af4680dfa8bce3490717d58ba889ddb5928366642be",
              "b318e0ec3354028add669827f9d4b2870aaa971d2f7e5ed1d0b297483d83efd0"
            ],
            [
              "fa50c0f61d22e5f07e3acebb1aa07b128d0012209a28b9776d76a8793180eef9",
              "6b84c6922397eba9b72cd2872281a68a5e683293a57a213b38cd8d7d3f4f2811"
            ],
            [
              "da1d61d0ca721a11b1a5bf6b7d88e8421a288ab5d5bba5220e53d32b5f067ec2",
              "8157f55a7c99306c79c0766161c91e2966a73899d279b48a655fba0f1ad836f1"
            ],
            [
              "a8e282ff0c9706907215ff98e8fd416615311de0446f1e062a73b0610d064e13",
              "7f97355b8db81c09abfb7f3c5b2515888b679a3e50dd6bd6cef7c73111f4cc0c"
            ],
            [
              "174a53b9c9a285872d39e56e6913cab15d59b1fa512508c022f382de8319497c",
              "ccc9dc37abfc9c1657b4155f2c47f9e6646b3a1d8cb9854383da13ac079afa73"
            ],
            [
              "959396981943785c3d3e57edf5018cdbe039e730e4918b3d884fdff09475b7ba",
              "2e7e552888c331dd8ba0386a4b9cd6849c653f64c8709385e9b8abf87524f2fd"
            ],
            [
              "d2a63a50ae401e56d645a1153b109a8fcca0a43d561fba2dbb51340c9d82b151",
              "e82d86fb6443fcb7565aee58b2948220a70f750af484ca52d4142174dcf89405"
            ],
            [
              "64587e2335471eb890ee7896d7cfdc866bacbdbd3839317b3436f9b45617e073",
              "d99fcdd5bf6902e2ae96dd6447c299a185b90a39133aeab358299e5e9faf6589"
            ],
            [
              "8481bde0e4e4d885b3a546d3e549de042f0aa6cea250e7fd358d6c86dd45e458",
              "38ee7b8cba5404dd84a25bf39cecb2ca900a79c42b262e556d64b1b59779057e"
            ],
            [
              "13464a57a78102aa62b6979ae817f4637ffcfed3c4b1ce30bcd6303f6caf666b",
              "69be159004614580ef7e433453ccb0ca48f300a81d0942e13f495a907f6ecc27"
            ],
            [
              "bc4a9df5b713fe2e9aef430bcc1dc97a0cd9ccede2f28588cada3a0d2d83f366",
              "d3a81ca6e785c06383937adf4b798caa6e8a9fbfa547b16d758d666581f33c1"
            ],
            [
              "8c28a97bf8298bc0d23d8c749452a32e694b65e30a9472a3954ab30fe5324caa",
              "40a30463a3305193378fedf31f7cc0eb7ae784f0451cb9459e71dc73cbef9482"
            ],
            [
              "8ea9666139527a8c1dd94ce4f071fd23c8b350c5a4bb33748c4ba111faccae0",
              "620efabbc8ee2782e24e7c0cfb95c5d735b783be9cf0f8e955af34a30e62b945"
            ],
            [
              "dd3625faef5ba06074669716bbd3788d89bdde815959968092f76cc4eb9a9787",
              "7a188fa3520e30d461da2501045731ca941461982883395937f68d00c644a573"
            ],
            [
              "f710d79d9eb962297e4f6232b40e8f7feb2bc63814614d692c12de752408221e",
              "ea98e67232d3b3295d3b535532115ccac8612c721851617526ae47a9c77bfc82"
            ]
          ]
        },
        naf: {
          wnd: 7,
          points: [
            [
              "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
              "388f7b0f632de8140fe337e62a37f3566500a99934c2231b6cb9fd7584b8e672"
            ],
            [
              "2f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4",
              "d8ac222636e5e3d6d4dba9dda6c9c426f788271bab0d6840dca87d3aa6ac62d6"
            ],
            [
              "5cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc",
              "6aebca40ba255960a3178d6d861a54dba813d0b813fde7b5a5082628087264da"
            ],
            [
              "acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe",
              "cc338921b0a7d9fd64380971763b61e9add888a4375f8e0f05cc262ac64f9c37"
            ],
            [
              "774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb",
              "d984a032eb6b5e190243dd56d7b7b365372db1e2dff9d6a8301d74c9c953c61b"
            ],
            [
              "f28773c2d975288bc7d1d205c3748651b075fbc6610e58cddeeddf8f19405aa8",
              "ab0902e8d880a89758212eb65cdaf473a1a06da521fa91f29b5cb52db03ed81"
            ],
            [
              "d7924d4f7d43ea965a465ae3095ff41131e5946f3c85f79e44adbcf8e27e080e",
              "581e2872a86c72a683842ec228cc6defea40af2bd896d3a5c504dc9ff6a26b58"
            ],
            [
              "defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34",
              "4211ab0694635168e997b0ead2a93daeced1f4a04a95c0f6cfb199f69e56eb77"
            ],
            [
              "2b4ea0a797a443d293ef5cff444f4979f06acfebd7e86d277475656138385b6c",
              "85e89bc037945d93b343083b5a1c86131a01f60c50269763b570c854e5c09b7a"
            ],
            [
              "352bbf4a4cdd12564f93fa332ce333301d9ad40271f8107181340aef25be59d5",
              "321eb4075348f534d59c18259dda3e1f4a1b3b2e71b1039c67bd3d8bcf81998c"
            ],
            [
              "2fa2104d6b38d11b0230010559879124e42ab8dfeff5ff29dc9cdadd4ecacc3f",
              "2de1068295dd865b64569335bd5dd80181d70ecfc882648423ba76b532b7d67"
            ],
            [
              "9248279b09b4d68dab21a9b066edda83263c3d84e09572e269ca0cd7f5453714",
              "73016f7bf234aade5d1aa71bdea2b1ff3fc0de2a887912ffe54a32ce97cb3402"
            ],
            [
              "daed4f2be3a8bf278e70132fb0beb7522f570e144bf615c07e996d443dee8729",
              "a69dce4a7d6c98e8d4a1aca87ef8d7003f83c230f3afa726ab40e52290be1c55"
            ],
            [
              "c44d12c7065d812e8acf28d7cbb19f9011ecd9e9fdf281b0e6a3b5e87d22e7db",
              "2119a460ce326cdc76c45926c982fdac0e106e861edf61c5a039063f0e0e6482"
            ],
            [
              "6a245bf6dc698504c89a20cfded60853152b695336c28063b61c65cbd269e6b4",
              "e022cf42c2bd4a708b3f5126f16a24ad8b33ba48d0423b6efd5e6348100d8a82"
            ],
            [
              "1697ffa6fd9de627c077e3d2fe541084ce13300b0bec1146f95ae57f0d0bd6a5",
              "b9c398f186806f5d27561506e4557433a2cf15009e498ae7adee9d63d01b2396"
            ],
            [
              "605bdb019981718b986d0f07e834cb0d9deb8360ffb7f61df982345ef27a7479",
              "2972d2de4f8d20681a78d93ec96fe23c26bfae84fb14db43b01e1e9056b8c49"
            ],
            [
              "62d14dab4150bf497402fdc45a215e10dcb01c354959b10cfe31c7e9d87ff33d",
              "80fc06bd8cc5b01098088a1950eed0db01aa132967ab472235f5642483b25eaf"
            ],
            [
              "80c60ad0040f27dade5b4b06c408e56b2c50e9f56b9b8b425e555c2f86308b6f",
              "1c38303f1cc5c30f26e66bad7fe72f70a65eed4cbe7024eb1aa01f56430bd57a"
            ],
            [
              "7a9375ad6167ad54aa74c6348cc54d344cc5dc9487d847049d5eabb0fa03c8fb",
              "d0e3fa9eca8726909559e0d79269046bdc59ea10c70ce2b02d499ec224dc7f7"
            ],
            [
              "d528ecd9b696b54c907a9ed045447a79bb408ec39b68df504bb51f459bc3ffc9",
              "eecf41253136e5f99966f21881fd656ebc4345405c520dbc063465b521409933"
            ],
            [
              "49370a4b5f43412ea25f514e8ecdad05266115e4a7ecb1387231808f8b45963",
              "758f3f41afd6ed428b3081b0512fd62a54c3f3afbb5b6764b653052a12949c9a"
            ],
            [
              "77f230936ee88cbbd73df930d64702ef881d811e0e1498e2f1c13eb1fc345d74",
              "958ef42a7886b6400a08266e9ba1b37896c95330d97077cbbe8eb3c7671c60d6"
            ],
            [
              "f2dac991cc4ce4b9ea44887e5c7c0bce58c80074ab9d4dbaeb28531b7739f530",
              "e0dedc9b3b2f8dad4da1f32dec2531df9eb5fbeb0598e4fd1a117dba703a3c37"
            ],
            [
              "463b3d9f662621fb1b4be8fbbe2520125a216cdfc9dae3debcba4850c690d45b",
              "5ed430d78c296c3543114306dd8622d7c622e27c970a1de31cb377b01af7307e"
            ],
            [
              "f16f804244e46e2a09232d4aff3b59976b98fac14328a2d1a32496b49998f247",
              "cedabd9b82203f7e13d206fcdf4e33d92a6c53c26e5cce26d6579962c4e31df6"
            ],
            [
              "caf754272dc84563b0352b7a14311af55d245315ace27c65369e15f7151d41d1",
              "cb474660ef35f5f2a41b643fa5e460575f4fa9b7962232a5c32f908318a04476"
            ],
            [
              "2600ca4b282cb986f85d0f1709979d8b44a09c07cb86d7c124497bc86f082120",
              "4119b88753c15bd6a693b03fcddbb45d5ac6be74ab5f0ef44b0be9475a7e4b40"
            ],
            [
              "7635ca72d7e8432c338ec53cd12220bc01c48685e24f7dc8c602a7746998e435",
              "91b649609489d613d1d5e590f78e6d74ecfc061d57048bad9e76f302c5b9c61"
            ],
            [
              "754e3239f325570cdbbf4a87deee8a66b7f2b33479d468fbc1a50743bf56cc18",
              "673fb86e5bda30fb3cd0ed304ea49a023ee33d0197a695d0c5d98093c536683"
            ],
            [
              "e3e6bd1071a1e96aff57859c82d570f0330800661d1c952f9fe2694691d9b9e8",
              "59c9e0bba394e76f40c0aa58379a3cb6a5a2283993e90c4167002af4920e37f5"
            ],
            [
              "186b483d056a033826ae73d88f732985c4ccb1f32ba35f4b4cc47fdcf04aa6eb",
              "3b952d32c67cf77e2e17446e204180ab21fb8090895138b4a4a797f86e80888b"
            ],
            [
              "df9d70a6b9876ce544c98561f4be4f725442e6d2b737d9c91a8321724ce0963f",
              "55eb2dafd84d6ccd5f862b785dc39d4ab157222720ef9da217b8c45cf2ba2417"
            ],
            [
              "5edd5cc23c51e87a497ca815d5dce0f8ab52554f849ed8995de64c5f34ce7143",
              "efae9c8dbc14130661e8cec030c89ad0c13c66c0d17a2905cdc706ab7399a868"
            ],
            [
              "290798c2b6476830da12fe02287e9e777aa3fba1c355b17a722d362f84614fba",
              "e38da76dcd440621988d00bcf79af25d5b29c094db2a23146d003afd41943e7a"
            ],
            [
              "af3c423a95d9f5b3054754efa150ac39cd29552fe360257362dfdecef4053b45",
              "f98a3fd831eb2b749a93b0e6f35cfb40c8cd5aa667a15581bc2feded498fd9c6"
            ],
            [
              "766dbb24d134e745cccaa28c99bf274906bb66b26dcf98df8d2fed50d884249a",
              "744b1152eacbe5e38dcc887980da38b897584a65fa06cedd2c924f97cbac5996"
            ],
            [
              "59dbf46f8c94759ba21277c33784f41645f7b44f6c596a58ce92e666191abe3e",
              "c534ad44175fbc300f4ea6ce648309a042ce739a7919798cd85e216c4a307f6e"
            ],
            [
              "f13ada95103c4537305e691e74e9a4a8dd647e711a95e73cb62dc6018cfd87b8",
              "e13817b44ee14de663bf4bc808341f326949e21a6a75c2570778419bdaf5733d"
            ],
            [
              "7754b4fa0e8aced06d4167a2c59cca4cda1869c06ebadfb6488550015a88522c",
              "30e93e864e669d82224b967c3020b8fa8d1e4e350b6cbcc537a48b57841163a2"
            ],
            [
              "948dcadf5990e048aa3874d46abef9d701858f95de8041d2a6828c99e2262519",
              "e491a42537f6e597d5d28a3224b1bc25df9154efbd2ef1d2cbba2cae5347d57e"
            ],
            [
              "7962414450c76c1689c7b48f8202ec37fb224cf5ac0bfa1570328a8a3d7c77ab",
              "100b610ec4ffb4760d5c1fc133ef6f6b12507a051f04ac5760afa5b29db83437"
            ],
            [
              "3514087834964b54b15b160644d915485a16977225b8847bb0dd085137ec47ca",
              "ef0afbb2056205448e1652c48e8127fc6039e77c15c2378b7e7d15a0de293311"
            ],
            [
              "d3cc30ad6b483e4bc79ce2c9dd8bc54993e947eb8df787b442943d3f7b527eaf",
              "8b378a22d827278d89c5e9be8f9508ae3c2ad46290358630afb34db04eede0a4"
            ],
            [
              "1624d84780732860ce1c78fcbfefe08b2b29823db913f6493975ba0ff4847610",
              "68651cf9b6da903e0914448c6cd9d4ca896878f5282be4c8cc06e2a404078575"
            ],
            [
              "733ce80da955a8a26902c95633e62a985192474b5af207da6df7b4fd5fc61cd4",
              "f5435a2bd2badf7d485a4d8b8db9fcce3e1ef8e0201e4578c54673bc1dc5ea1d"
            ],
            [
              "15d9441254945064cf1a1c33bbd3b49f8966c5092171e699ef258dfab81c045c",
              "d56eb30b69463e7234f5137b73b84177434800bacebfc685fc37bbe9efe4070d"
            ],
            [
              "a1d0fcf2ec9de675b612136e5ce70d271c21417c9d2b8aaaac138599d0717940",
              "edd77f50bcb5a3cab2e90737309667f2641462a54070f3d519212d39c197a629"
            ],
            [
              "e22fbe15c0af8ccc5780c0735f84dbe9a790badee8245c06c7ca37331cb36980",
              "a855babad5cd60c88b430a69f53a1a7a38289154964799be43d06d77d31da06"
            ],
            [
              "311091dd9860e8e20ee13473c1155f5f69635e394704eaa74009452246cfa9b3",
              "66db656f87d1f04fffd1f04788c06830871ec5a64feee685bd80f0b1286d8374"
            ],
            [
              "34c1fd04d301be89b31c0442d3e6ac24883928b45a9340781867d4232ec2dbdf",
              "9414685e97b1b5954bd46f730174136d57f1ceeb487443dc5321857ba73abee"
            ],
            [
              "f219ea5d6b54701c1c14de5b557eb42a8d13f3abbcd08affcc2a5e6b049b8d63",
              "4cb95957e83d40b0f73af4544cccf6b1f4b08d3c07b27fb8d8c2962a400766d1"
            ],
            [
              "d7b8740f74a8fbaab1f683db8f45de26543a5490bca627087236912469a0b448",
              "fa77968128d9c92ee1010f337ad4717eff15db5ed3c049b3411e0315eaa4593b"
            ],
            [
              "32d31c222f8f6f0ef86f7c98d3a3335ead5bcd32abdd94289fe4d3091aa824bf",
              "5f3032f5892156e39ccd3d7915b9e1da2e6dac9e6f26e961118d14b8462e1661"
            ],
            [
              "7461f371914ab32671045a155d9831ea8793d77cd59592c4340f86cbc18347b5",
              "8ec0ba238b96bec0cbdddcae0aa442542eee1ff50c986ea6b39847b3cc092ff6"
            ],
            [
              "ee079adb1df1860074356a25aa38206a6d716b2c3e67453d287698bad7b2b2d6",
              "8dc2412aafe3be5c4c5f37e0ecc5f9f6a446989af04c4e25ebaac479ec1c8c1e"
            ],
            [
              "16ec93e447ec83f0467b18302ee620f7e65de331874c9dc72bfd8616ba9da6b5",
              "5e4631150e62fb40d0e8c2a7ca5804a39d58186a50e497139626778e25b0674d"
            ],
            [
              "eaa5f980c245f6f038978290afa70b6bd8855897f98b6aa485b96065d537bd99",
              "f65f5d3e292c2e0819a528391c994624d784869d7e6ea67fb18041024edc07dc"
            ],
            [
              "78c9407544ac132692ee1910a02439958ae04877151342ea96c4b6b35a49f51",
              "f3e0319169eb9b85d5404795539a5e68fa1fbd583c064d2462b675f194a3ddb4"
            ],
            [
              "494f4be219a1a77016dcd838431aea0001cdc8ae7a6fc688726578d9702857a5",
              "42242a969283a5f339ba7f075e36ba2af925ce30d767ed6e55f4b031880d562c"
            ],
            [
              "a598a8030da6d86c6bc7f2f5144ea549d28211ea58faa70ebf4c1e665c1fe9b5",
              "204b5d6f84822c307e4b4a7140737aec23fc63b65b35f86a10026dbd2d864e6b"
            ],
            [
              "c41916365abb2b5d09192f5f2dbeafec208f020f12570a184dbadc3e58595997",
              "4f14351d0087efa49d245b328984989d5caf9450f34bfc0ed16e96b58fa9913"
            ],
            [
              "841d6063a586fa475a724604da03bc5b92a2e0d2e0a36acfe4c73a5514742881",
              "73867f59c0659e81904f9a1c7543698e62562d6744c169ce7a36de01a8d6154"
            ],
            [
              "5e95bb399a6971d376026947f89bde2f282b33810928be4ded112ac4d70e20d5",
              "39f23f366809085beebfc71181313775a99c9aed7d8ba38b161384c746012865"
            ],
            [
              "36e4641a53948fd476c39f8a99fd974e5ec07564b5315d8bf99471bca0ef2f66",
              "d2424b1b1abe4eb8164227b085c9aa9456ea13493fd563e06fd51cf5694c78fc"
            ],
            [
              "336581ea7bfbbb290c191a2f507a41cf5643842170e914faeab27c2c579f726",
              "ead12168595fe1be99252129b6e56b3391f7ab1410cd1e0ef3dcdcabd2fda224"
            ],
            [
              "8ab89816dadfd6b6a1f2634fcf00ec8403781025ed6890c4849742706bd43ede",
              "6fdcef09f2f6d0a044e654aef624136f503d459c3e89845858a47a9129cdd24e"
            ],
            [
              "1e33f1a746c9c5778133344d9299fcaa20b0938e8acff2544bb40284b8c5fb94",
              "60660257dd11b3aa9c8ed618d24edff2306d320f1d03010e33a7d2057f3b3b6"
            ],
            [
              "85b7c1dcb3cec1b7ee7f30ded79dd20a0ed1f4cc18cbcfcfa410361fd8f08f31",
              "3d98a9cdd026dd43f39048f25a8847f4fcafad1895d7a633c6fed3c35e999511"
            ],
            [
              "29df9fbd8d9e46509275f4b125d6d45d7fbe9a3b878a7af872a2800661ac5f51",
              "b4c4fe99c775a606e2d8862179139ffda61dc861c019e55cd2876eb2a27d84b"
            ],
            [
              "a0b1cae06b0a847a3fea6e671aaf8adfdfe58ca2f768105c8082b2e449fce252",
              "ae434102edde0958ec4b19d917a6a28e6b72da1834aff0e650f049503a296cf2"
            ],
            [
              "4e8ceafb9b3e9a136dc7ff67e840295b499dfb3b2133e4ba113f2e4c0e121e5",
              "cf2174118c8b6d7a4b48f6d534ce5c79422c086a63460502b827ce62a326683c"
            ],
            [
              "d24a44e047e19b6f5afb81c7ca2f69080a5076689a010919f42725c2b789a33b",
              "6fb8d5591b466f8fc63db50f1c0f1c69013f996887b8244d2cdec417afea8fa3"
            ],
            [
              "ea01606a7a6c9cdd249fdfcfacb99584001edd28abbab77b5104e98e8e3b35d4",
              "322af4908c7312b0cfbfe369f7a7b3cdb7d4494bc2823700cfd652188a3ea98d"
            ],
            [
              "af8addbf2b661c8a6c6328655eb96651252007d8c5ea31be4ad196de8ce2131f",
              "6749e67c029b85f52a034eafd096836b2520818680e26ac8f3dfbcdb71749700"
            ],
            [
              "e3ae1974566ca06cc516d47e0fb165a674a3dabcfca15e722f0e3450f45889",
              "2aeabe7e4531510116217f07bf4d07300de97e4874f81f533420a72eeb0bd6a4"
            ],
            [
              "591ee355313d99721cf6993ffed1e3e301993ff3ed258802075ea8ced397e246",
              "b0ea558a113c30bea60fc4775460c7901ff0b053d25ca2bdeee98f1a4be5d196"
            ],
            [
              "11396d55fda54c49f19aa97318d8da61fa8584e47b084945077cf03255b52984",
              "998c74a8cd45ac01289d5833a7beb4744ff536b01b257be4c5767bea93ea57a4"
            ],
            [
              "3c5d2a1ba39c5a1790000738c9e0c40b8dcdfd5468754b6405540157e017aa7a",
              "b2284279995a34e2f9d4de7396fc18b80f9b8b9fdd270f6661f79ca4c81bd257"
            ],
            [
              "cc8704b8a60a0defa3a99a7299f2e9c3fbc395afb04ac078425ef8a1793cc030",
              "bdd46039feed17881d1e0862db347f8cf395b74fc4bcdc4e940b74e3ac1f1b13"
            ],
            [
              "c533e4f7ea8555aacd9777ac5cad29b97dd4defccc53ee7ea204119b2889b197",
              "6f0a256bc5efdf429a2fb6242f1a43a2d9b925bb4a4b3a26bb8e0f45eb596096"
            ],
            [
              "c14f8f2ccb27d6f109f6d08d03cc96a69ba8c34eec07bbcf566d48e33da6593",
              "c359d6923bb398f7fd4473e16fe1c28475b740dd098075e6c0e8649113dc3a38"
            ],
            [
              "a6cbc3046bc6a450bac24789fa17115a4c9739ed75f8f21ce441f72e0b90e6ef",
              "21ae7f4680e889bb130619e2c0f95a360ceb573c70603139862afd617fa9b9f"
            ],
            [
              "347d6d9a02c48927ebfb86c1359b1caf130a3c0267d11ce6344b39f99d43cc38",
              "60ea7f61a353524d1c987f6ecec92f086d565ab687870cb12689ff1e31c74448"
            ],
            [
              "da6545d2181db8d983f7dcb375ef5866d47c67b1bf31c8cf855ef7437b72656a",
              "49b96715ab6878a79e78f07ce5680c5d6673051b4935bd897fea824b77dc208a"
            ],
            [
              "c40747cc9d012cb1a13b8148309c6de7ec25d6945d657146b9d5994b8feb1111",
              "5ca560753be2a12fc6de6caf2cb489565db936156b9514e1bb5e83037e0fa2d4"
            ],
            [
              "4e42c8ec82c99798ccf3a610be870e78338c7f713348bd34c8203ef4037f3502",
              "7571d74ee5e0fb92a7a8b33a07783341a5492144cc54bcc40a94473693606437"
            ],
            [
              "3775ab7089bc6af823aba2e1af70b236d251cadb0c86743287522a1b3b0dedea",
              "be52d107bcfa09d8bcb9736a828cfa7fac8db17bf7a76a2c42ad961409018cf7"
            ],
            [
              "cee31cbf7e34ec379d94fb814d3d775ad954595d1314ba8846959e3e82f74e26",
              "8fd64a14c06b589c26b947ae2bcf6bfa0149ef0be14ed4d80f448a01c43b1c6d"
            ],
            [
              "b4f9eaea09b6917619f6ea6a4eb5464efddb58fd45b1ebefcdc1a01d08b47986",
              "39e5c9925b5a54b07433a4f18c61726f8bb131c012ca542eb24a8ac07200682a"
            ],
            [
              "d4263dfc3d2df923a0179a48966d30ce84e2515afc3dccc1b77907792ebcc60e",
              "62dfaf07a0f78feb30e30d6295853ce189e127760ad6cf7fae164e122a208d54"
            ],
            [
              "48457524820fa65a4f8d35eb6930857c0032acc0a4a2de422233eeda897612c4",
              "25a748ab367979d98733c38a1fa1c2e7dc6cc07db2d60a9ae7a76aaa49bd0f77"
            ],
            [
              "dfeeef1881101f2cb11644f3a2afdfc2045e19919152923f367a1767c11cceda",
              "ecfb7056cf1de042f9420bab396793c0c390bde74b4bbdff16a83ae09a9a7517"
            ],
            [
              "6d7ef6b17543f8373c573f44e1f389835d89bcbc6062ced36c82df83b8fae859",
              "cd450ec335438986dfefa10c57fea9bcc521a0959b2d80bbf74b190dca712d10"
            ],
            [
              "e75605d59102a5a2684500d3b991f2e3f3c88b93225547035af25af66e04541f",
              "f5c54754a8f71ee540b9b48728473e314f729ac5308b06938360990e2bfad125"
            ],
            [
              "eb98660f4c4dfaa06a2be453d5020bc99a0c2e60abe388457dd43fefb1ed620c",
              "6cb9a8876d9cb8520609af3add26cd20a0a7cd8a9411131ce85f44100099223e"
            ],
            [
              "13e87b027d8514d35939f2e6892b19922154596941888336dc3563e3b8dba942",
              "fef5a3c68059a6dec5d624114bf1e91aac2b9da568d6abeb2570d55646b8adf1"
            ],
            [
              "ee163026e9fd6fe017c38f06a5be6fc125424b371ce2708e7bf4491691e5764a",
              "1acb250f255dd61c43d94ccc670d0f58f49ae3fa15b96623e5430da0ad6c62b2"
            ],
            [
              "b268f5ef9ad51e4d78de3a750c2dc89b1e626d43505867999932e5db33af3d80",
              "5f310d4b3c99b9ebb19f77d41c1dee018cf0d34fd4191614003e945a1216e423"
            ],
            [
              "ff07f3118a9df035e9fad85eb6c7bfe42b02f01ca99ceea3bf7ffdba93c4750d",
              "438136d603e858a3a5c440c38eccbaddc1d2942114e2eddd4740d098ced1f0d8"
            ],
            [
              "8d8b9855c7c052a34146fd20ffb658bea4b9f69e0d825ebec16e8c3ce2b526a1",
              "cdb559eedc2d79f926baf44fb84ea4d44bcf50fee51d7ceb30e2e7f463036758"
            ],
            [
              "52db0b5384dfbf05bfa9d472d7ae26dfe4b851ceca91b1eba54263180da32b63",
              "c3b997d050ee5d423ebaf66a6db9f57b3180c902875679de924b69d84a7b375"
            ],
            [
              "e62f9490d3d51da6395efd24e80919cc7d0f29c3f3fa48c6fff543becbd43352",
              "6d89ad7ba4876b0b22c2ca280c682862f342c8591f1daf5170e07bfd9ccafa7d"
            ],
            [
              "7f30ea2476b399b4957509c88f77d0191afa2ff5cb7b14fd6d8e7d65aaab1193",
              "ca5ef7d4b231c94c3b15389a5f6311e9daff7bb67b103e9880ef4bff637acaec"
            ],
            [
              "5098ff1e1d9f14fb46a210fada6c903fef0fb7b4a1dd1d9ac60a0361800b7a00",
              "9731141d81fc8f8084d37c6e7542006b3ee1b40d60dfe5362a5b132fd17ddc0"
            ],
            [
              "32b78c7de9ee512a72895be6b9cbefa6e2f3c4ccce445c96b9f2c81e2778ad58",
              "ee1849f513df71e32efc3896ee28260c73bb80547ae2275ba497237794c8753c"
            ],
            [
              "e2cb74fddc8e9fbcd076eef2a7c72b0ce37d50f08269dfc074b581550547a4f7",
              "d3aa2ed71c9dd2247a62df062736eb0baddea9e36122d2be8641abcb005cc4a4"
            ],
            [
              "8438447566d4d7bedadc299496ab357426009a35f235cb141be0d99cd10ae3a8",
              "c4e1020916980a4da5d01ac5e6ad330734ef0d7906631c4f2390426b2edd791f"
            ],
            [
              "4162d488b89402039b584c6fc6c308870587d9c46f660b878ab65c82c711d67e",
              "67163e903236289f776f22c25fb8a3afc1732f2b84b4e95dbda47ae5a0852649"
            ],
            [
              "3fad3fa84caf0f34f0f89bfd2dcf54fc175d767aec3e50684f3ba4a4bf5f683d",
              "cd1bc7cb6cc407bb2f0ca647c718a730cf71872e7d0d2a53fa20efcdfe61826"
            ],
            [
              "674f2600a3007a00568c1a7ce05d0816c1fb84bf1370798f1c69532faeb1a86b",
              "299d21f9413f33b3edf43b257004580b70db57da0b182259e09eecc69e0d38a5"
            ],
            [
              "d32f4da54ade74abb81b815ad1fb3b263d82d6c692714bcff87d29bd5ee9f08f",
              "f9429e738b8e53b968e99016c059707782e14f4535359d582fc416910b3eea87"
            ],
            [
              "30e4e670435385556e593657135845d36fbb6931f72b08cb1ed954f1e3ce3ff6",
              "462f9bce619898638499350113bbc9b10a878d35da70740dc695a559eb88db7b"
            ],
            [
              "be2062003c51cc3004682904330e4dee7f3dcd10b01e580bf1971b04d4cad297",
              "62188bc49d61e5428573d48a74e1c655b1c61090905682a0d5558ed72dccb9bc"
            ],
            [
              "93144423ace3451ed29e0fb9ac2af211cb6e84a601df5993c419859fff5df04a",
              "7c10dfb164c3425f5c71a3f9d7992038f1065224f72bb9d1d902a6d13037b47c"
            ],
            [
              "b015f8044f5fcbdcf21ca26d6c34fb8197829205c7b7d2a7cb66418c157b112c",
              "ab8c1e086d04e813744a655b2df8d5f83b3cdc6faa3088c1d3aea1454e3a1d5f"
            ],
            [
              "d5e9e1da649d97d89e4868117a465a3a4f8a18de57a140d36b3f2af341a21b52",
              "4cb04437f391ed73111a13cc1d4dd0db1693465c2240480d8955e8592f27447a"
            ],
            [
              "d3ae41047dd7ca065dbf8ed77b992439983005cd72e16d6f996a5316d36966bb",
              "bd1aeb21ad22ebb22a10f0303417c6d964f8cdd7df0aca614b10dc14d125ac46"
            ],
            [
              "463e2763d885f958fc66cdd22800f0a487197d0a82e377b49f80af87c897b065",
              "bfefacdb0e5d0fd7df3a311a94de062b26b80c61fbc97508b79992671ef7ca7f"
            ],
            [
              "7985fdfd127c0567c6f53ec1bb63ec3158e597c40bfe747c83cddfc910641917",
              "603c12daf3d9862ef2b25fe1de289aed24ed291e0ec6708703a5bd567f32ed03"
            ],
            [
              "74a1ad6b5f76e39db2dd249410eac7f99e74c59cb83d2d0ed5ff1543da7703e9",
              "cc6157ef18c9c63cd6193d83631bbea0093e0968942e8c33d5737fd790e0db08"
            ],
            [
              "30682a50703375f602d416664ba19b7fc9bab42c72747463a71d0896b22f6da3",
              "553e04f6b018b4fa6c8f39e7f311d3176290d0e0f19ca73f17714d9977a22ff8"
            ],
            [
              "9e2158f0d7c0d5f26c3791efefa79597654e7a2b2464f52b1ee6c1347769ef57",
              "712fcdd1b9053f09003a3481fa7762e9ffd7c8ef35a38509e2fbf2629008373"
            ],
            [
              "176e26989a43c9cfeba4029c202538c28172e566e3c4fce7322857f3be327d66",
              "ed8cc9d04b29eb877d270b4878dc43c19aefd31f4eee09ee7b47834c1fa4b1c3"
            ],
            [
              "75d46efea3771e6e68abb89a13ad747ecf1892393dfc4f1b7004788c50374da8",
              "9852390a99507679fd0b86fd2b39a868d7efc22151346e1a3ca4726586a6bed8"
            ],
            [
              "809a20c67d64900ffb698c4c825f6d5f2310fb0451c869345b7319f645605721",
              "9e994980d9917e22b76b061927fa04143d096ccc54963e6a5ebfa5f3f8e286c1"
            ],
            [
              "1b38903a43f7f114ed4500b4eac7083fdefece1cf29c63528d563446f972c180",
              "4036edc931a60ae889353f77fd53de4a2708b26b6f5da72ad3394119daf408f9"
            ]
          ]
        }
      };
    }
  });

  // node_modules/elliptic/lib/elliptic/curves.js
  var require_curves = __commonJS({
    "node_modules/elliptic/lib/elliptic/curves.js"(exports) {
      "use strict";
      var curves = exports;
      var hash3 = require_hash();
      var curve = require_curve();
      var utils = require_utils2();
      var assert2 = utils.assert;
      function PresetCurve(options) {
        if (options.type === "short")
          this.curve = new curve.short(options);
        else if (options.type === "edwards")
          this.curve = new curve.edwards(options);
        else
          this.curve = new curve.mont(options);
        this.g = this.curve.g;
        this.n = this.curve.n;
        this.hash = options.hash;
        assert2(this.g.validate(), "Invalid curve");
        assert2(this.g.mul(this.n).isInfinity(), "Invalid curve, G*N != O");
      }
      curves.PresetCurve = PresetCurve;
      function defineCurve(name4, options) {
        Object.defineProperty(curves, name4, {
          configurable: true,
          enumerable: true,
          get: function() {
            var curve2 = new PresetCurve(options);
            Object.defineProperty(curves, name4, {
              configurable: true,
              enumerable: true,
              value: curve2
            });
            return curve2;
          }
        });
      }
      defineCurve("p192", {
        type: "short",
        prime: "p192",
        p: "ffffffff ffffffff ffffffff fffffffe ffffffff ffffffff",
        a: "ffffffff ffffffff ffffffff fffffffe ffffffff fffffffc",
        b: "64210519 e59c80e7 0fa7e9ab 72243049 feb8deec c146b9b1",
        n: "ffffffff ffffffff ffffffff 99def836 146bc9b1 b4d22831",
        hash: hash3.sha256,
        gRed: false,
        g: [
          "188da80e b03090f6 7cbf20eb 43a18800 f4ff0afd 82ff1012",
          "07192b95 ffc8da78 631011ed 6b24cdd5 73f977a1 1e794811"
        ]
      });
      defineCurve("p224", {
        type: "short",
        prime: "p224",
        p: "ffffffff ffffffff ffffffff ffffffff 00000000 00000000 00000001",
        a: "ffffffff ffffffff ffffffff fffffffe ffffffff ffffffff fffffffe",
        b: "b4050a85 0c04b3ab f5413256 5044b0b7 d7bfd8ba 270b3943 2355ffb4",
        n: "ffffffff ffffffff ffffffff ffff16a2 e0b8f03e 13dd2945 5c5c2a3d",
        hash: hash3.sha256,
        gRed: false,
        g: [
          "b70e0cbd 6bb4bf7f 321390b9 4a03c1d3 56c21122 343280d6 115c1d21",
          "bd376388 b5f723fb 4c22dfe6 cd4375a0 5a074764 44d58199 85007e34"
        ]
      });
      defineCurve("p256", {
        type: "short",
        prime: null,
        p: "ffffffff 00000001 00000000 00000000 00000000 ffffffff ffffffff ffffffff",
        a: "ffffffff 00000001 00000000 00000000 00000000 ffffffff ffffffff fffffffc",
        b: "5ac635d8 aa3a93e7 b3ebbd55 769886bc 651d06b0 cc53b0f6 3bce3c3e 27d2604b",
        n: "ffffffff 00000000 ffffffff ffffffff bce6faad a7179e84 f3b9cac2 fc632551",
        hash: hash3.sha256,
        gRed: false,
        g: [
          "6b17d1f2 e12c4247 f8bce6e5 63a440f2 77037d81 2deb33a0 f4a13945 d898c296",
          "4fe342e2 fe1a7f9b 8ee7eb4a 7c0f9e16 2bce3357 6b315ece cbb64068 37bf51f5"
        ]
      });
      defineCurve("p384", {
        type: "short",
        prime: null,
        p: "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe ffffffff 00000000 00000000 ffffffff",
        a: "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe ffffffff 00000000 00000000 fffffffc",
        b: "b3312fa7 e23ee7e4 988e056b e3f82d19 181d9c6e fe814112 0314088f 5013875a c656398d 8a2ed19d 2a85c8ed d3ec2aef",
        n: "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff c7634d81 f4372ddf 581a0db2 48b0a77a ecec196a ccc52973",
        hash: hash3.sha384,
        gRed: false,
        g: [
          "aa87ca22 be8b0537 8eb1c71e f320ad74 6e1d3b62 8ba79b98 59f741e0 82542a38 5502f25d bf55296c 3a545e38 72760ab7",
          "3617de4a 96262c6f 5d9e98bf 9292dc29 f8f41dbd 289a147c e9da3113 b5f0b8c0 0a60b1ce 1d7e819d 7a431d7c 90ea0e5f"
        ]
      });
      defineCurve("p521", {
        type: "short",
        prime: null,
        p: "000001ff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff",
        a: "000001ff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffc",
        b: "00000051 953eb961 8e1c9a1f 929a21a0 b68540ee a2da725b 99b315f3 b8b48991 8ef109e1 56193951 ec7e937b 1652c0bd 3bb1bf07 3573df88 3d2c34f1 ef451fd4 6b503f00",
        n: "000001ff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffa 51868783 bf2f966b 7fcc0148 f709a5d0 3bb5c9b8 899c47ae bb6fb71e 91386409",
        hash: hash3.sha512,
        gRed: false,
        g: [
          "000000c6 858e06b7 0404e9cd 9e3ecb66 2395b442 9c648139 053fb521 f828af60 6b4d3dba a14b5e77 efe75928 fe1dc127 a2ffa8de 3348b3c1 856a429b f97e7e31 c2e5bd66",
          "00000118 39296a78 9a3bc004 5c8a5fb4 2c7d1bd9 98f54449 579b4468 17afbd17 273e662c 97ee7299 5ef42640 c550b901 3fad0761 353c7086 a272c240 88be9476 9fd16650"
        ]
      });
      defineCurve("curve25519", {
        type: "mont",
        prime: "p25519",
        p: "7fffffffffffffff ffffffffffffffff ffffffffffffffff ffffffffffffffed",
        a: "76d06",
        b: "1",
        n: "1000000000000000 0000000000000000 14def9dea2f79cd6 5812631a5cf5d3ed",
        hash: hash3.sha256,
        gRed: false,
        g: [
          "9"
        ]
      });
      defineCurve("ed25519", {
        type: "edwards",
        prime: "p25519",
        p: "7fffffffffffffff ffffffffffffffff ffffffffffffffff ffffffffffffffed",
        a: "-1",
        c: "1",
        // -121665 * (121666^(-1)) (mod P)
        d: "52036cee2b6ffe73 8cc740797779e898 00700a4d4141d8ab 75eb4dca135978a3",
        n: "1000000000000000 0000000000000000 14def9dea2f79cd6 5812631a5cf5d3ed",
        hash: hash3.sha256,
        gRed: false,
        g: [
          "216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a",
          // 4/5
          "6666666666666666666666666666666666666666666666666666666666666658"
        ]
      });
      var pre;
      try {
        pre = require_secp256k1();
      } catch (e) {
        pre = void 0;
      }
      defineCurve("secp256k1", {
        type: "short",
        prime: "k256",
        p: "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe fffffc2f",
        a: "0",
        b: "7",
        n: "ffffffff ffffffff ffffffff fffffffe baaedce6 af48a03b bfd25e8c d0364141",
        h: "1",
        hash: hash3.sha256,
        // Precomputed endomorphism
        beta: "7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee",
        lambda: "5363ad4cc05c30e0a5261c028812645a122e22ea20816678df02967c1b23bd72",
        basis: [
          {
            a: "3086d221a7d46bcde86c90e49284eb15",
            b: "-e4437ed6010e88286f547fa90abfe4c3"
          },
          {
            a: "114ca50f7a8e2f3f657c1108d9d44cfd8",
            b: "3086d221a7d46bcde86c90e49284eb15"
          }
        ],
        gRed: false,
        g: [
          "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8",
          pre
        ]
      });
    }
  });

  // node_modules/hmac-drbg/lib/hmac-drbg.js
  var require_hmac_drbg = __commonJS({
    "node_modules/hmac-drbg/lib/hmac-drbg.js"(exports, module) {
      "use strict";
      var hash3 = require_hash();
      var utils = require_utils();
      var assert2 = require_minimalistic_assert();
      function HmacDRBG(options) {
        if (!(this instanceof HmacDRBG))
          return new HmacDRBG(options);
        this.hash = options.hash;
        this.predResist = !!options.predResist;
        this.outLen = this.hash.outSize;
        this.minEntropy = options.minEntropy || this.hash.hmacStrength;
        this._reseed = null;
        this.reseedInterval = null;
        this.K = null;
        this.V = null;
        var entropy = utils.toArray(options.entropy, options.entropyEnc || "hex");
        var nonce = utils.toArray(options.nonce, options.nonceEnc || "hex");
        var pers = utils.toArray(options.pers, options.persEnc || "hex");
        assert2(
            entropy.length >= this.minEntropy / 8,
            "Not enough entropy. Minimum is: " + this.minEntropy + " bits"
        );
        this._init(entropy, nonce, pers);
      }
      module.exports = HmacDRBG;
      HmacDRBG.prototype._init = function init(entropy, nonce, pers) {
        var seed = entropy.concat(nonce).concat(pers);
        this.K = new Array(this.outLen / 8);
        this.V = new Array(this.outLen / 8);
        for (var i = 0; i < this.V.length; i++) {
          this.K[i] = 0;
          this.V[i] = 1;
        }
        this._update(seed);
        this._reseed = 1;
        this.reseedInterval = 281474976710656;
      };
      HmacDRBG.prototype._hmac = function hmac() {
        return new hash3.hmac(this.hash, this.K);
      };
      HmacDRBG.prototype._update = function update(seed) {
        var kmac = this._hmac().update(this.V).update([0]);
        if (seed)
          kmac = kmac.update(seed);
        this.K = kmac.digest();
        this.V = this._hmac().update(this.V).digest();
        if (!seed)
          return;
        this.K = this._hmac().update(this.V).update([1]).update(seed).digest();
        this.V = this._hmac().update(this.V).digest();
      };
      HmacDRBG.prototype.reseed = function reseed(entropy, entropyEnc, add2, addEnc) {
        if (typeof entropyEnc !== "string") {
          addEnc = add2;
          add2 = entropyEnc;
          entropyEnc = null;
        }
        entropy = utils.toArray(entropy, entropyEnc);
        add2 = utils.toArray(add2, addEnc);
        assert2(
            entropy.length >= this.minEntropy / 8,
            "Not enough entropy. Minimum is: " + this.minEntropy + " bits"
        );
        this._update(entropy.concat(add2 || []));
        this._reseed = 1;
      };
      HmacDRBG.prototype.generate = function generate(len, enc, add2, addEnc) {
        if (this._reseed > this.reseedInterval)
          throw new Error("Reseed is required");
        if (typeof enc !== "string") {
          addEnc = add2;
          add2 = enc;
          enc = null;
        }
        if (add2) {
          add2 = utils.toArray(add2, addEnc || "hex");
          this._update(add2);
        }
        var temp = [];
        while (temp.length < len) {
          this.V = this._hmac().update(this.V).digest();
          temp = temp.concat(this.V);
        }
        var res = temp.slice(0, len);
        this._update(add2);
        this._reseed++;
        return utils.encode(res, enc);
      };
    }
  });

  // node_modules/elliptic/lib/elliptic/ec/key.js
  var require_key = __commonJS({
    "node_modules/elliptic/lib/elliptic/ec/key.js"(exports, module) {
      "use strict";
      var BN = require_bn();
      var utils = require_utils2();
      var assert2 = utils.assert;
      function KeyPair(ec2, options) {
        this.ec = ec2;
        this.priv = null;
        this.pub = null;
        if (options.priv)
          this._importPrivate(options.priv, options.privEnc);
        if (options.pub)
          this._importPublic(options.pub, options.pubEnc);
      }
      module.exports = KeyPair;
      KeyPair.fromPublic = function fromPublic(ec2, pub, enc) {
        if (pub instanceof KeyPair)
          return pub;
        return new KeyPair(ec2, {
          pub,
          pubEnc: enc
        });
      };
      KeyPair.fromPrivate = function fromPrivate(ec2, priv, enc) {
        if (priv instanceof KeyPair)
          return priv;
        return new KeyPair(ec2, {
          priv,
          privEnc: enc
        });
      };
      KeyPair.prototype.validate = function validate() {
        var pub = this.getPublic();
        if (pub.isInfinity())
          return { result: false, reason: "Invalid public key" };
        if (!pub.validate())
          return { result: false, reason: "Public key is not a point" };
        if (!pub.mul(this.ec.curve.n).isInfinity())
          return { result: false, reason: "Public key * N != O" };
        return { result: true, reason: null };
      };
      KeyPair.prototype.getPublic = function getPublic(compact, enc) {
        if (typeof compact === "string") {
          enc = compact;
          compact = null;
        }
        if (!this.pub)
          this.pub = this.ec.g.mul(this.priv);
        if (!enc)
          return this.pub;
        return this.pub.encode(enc, compact);
      };
      KeyPair.prototype.getPrivate = function getPrivate(enc) {
        if (enc === "hex")
          return this.priv.toString(16, 2);
        else
          return this.priv;
      };
      KeyPair.prototype._importPrivate = function _importPrivate(key, enc) {
        this.priv = new BN(key, enc || 16);
        this.priv = this.priv.umod(this.ec.curve.n);
      };
      KeyPair.prototype._importPublic = function _importPublic(key, enc) {
        if (key.x || key.y) {
          if (this.ec.curve.type === "mont") {
            assert2(key.x, "Need x coordinate");
          } else if (this.ec.curve.type === "short" || this.ec.curve.type === "edwards") {
            assert2(key.x && key.y, "Need both x and y coordinate");
          }
          this.pub = this.ec.curve.point(key.x, key.y);
          return;
        }
        this.pub = this.ec.curve.decodePoint(key, enc);
      };
      KeyPair.prototype.derive = function derive(pub) {
        if (!pub.validate()) {
          assert2(pub.validate(), "public point not validated");
        }
        return pub.mul(this.priv).getX();
      };
      KeyPair.prototype.sign = function sign(msg, enc, options) {
        return this.ec.sign(msg, this, enc, options);
      };
      KeyPair.prototype.verify = function verify(msg, signature) {
        return this.ec.verify(msg, signature, this);
      };
      KeyPair.prototype.inspect = function inspect() {
        return "<Key priv: " + (this.priv && this.priv.toString(16, 2)) + " pub: " + (this.pub && this.pub.inspect()) + " >";
      };
    }
  });

  // node_modules/elliptic/lib/elliptic/ec/signature.js
  var require_signature = __commonJS({
    "node_modules/elliptic/lib/elliptic/ec/signature.js"(exports, module) {
      "use strict";
      var BN = require_bn();
      var utils = require_utils2();
      var assert2 = utils.assert;
      function Signature(options, enc) {
        if (options instanceof Signature)
          return options;
        if (this._importDER(options, enc))
          return;
        assert2(options.r && options.s, "Signature without r or s");
        this.r = new BN(options.r, 16);
        this.s = new BN(options.s, 16);
        if (options.recoveryParam === void 0)
          this.recoveryParam = null;
        else
          this.recoveryParam = options.recoveryParam;
      }
      module.exports = Signature;
      function Position() {
        this.place = 0;
      }
      function getLength(buf2, p) {
        var initial = buf2[p.place++];
        if (!(initial & 128)) {
          return initial;
        }
        var octetLen = initial & 15;
        if (octetLen === 0 || octetLen > 4) {
          return false;
        }
        var val = 0;
        for (var i = 0, off = p.place; i < octetLen; i++, off++) {
          val <<= 8;
          val |= buf2[off];
          val >>>= 0;
        }
        if (val <= 127) {
          return false;
        }
        p.place = off;
        return val;
      }
      function rmPadding(buf2) {
        var i = 0;
        var len = buf2.length - 1;
        while (!buf2[i] && !(buf2[i + 1] & 128) && i < len) {
          i++;
        }
        if (i === 0) {
          return buf2;
        }
        return buf2.slice(i);
      }
      Signature.prototype._importDER = function _importDER(data, enc) {
        data = utils.toArray(data, enc);
        var p = new Position();
        if (data[p.place++] !== 48) {
          return false;
        }
        var len = getLength(data, p);
        if (len === false) {
          return false;
        }
        if (len + p.place !== data.length) {
          return false;
        }
        if (data[p.place++] !== 2) {
          return false;
        }
        var rlen = getLength(data, p);
        if (rlen === false) {
          return false;
        }
        var r = data.slice(p.place, rlen + p.place);
        p.place += rlen;
        if (data[p.place++] !== 2) {
          return false;
        }
        var slen = getLength(data, p);
        if (slen === false) {
          return false;
        }
        if (data.length !== slen + p.place) {
          return false;
        }
        var s = data.slice(p.place, slen + p.place);
        if (r[0] === 0) {
          if (r[1] & 128) {
            r = r.slice(1);
          } else {
            return false;
          }
        }
        if (s[0] === 0) {
          if (s[1] & 128) {
            s = s.slice(1);
          } else {
            return false;
          }
        }
        this.r = new BN(r);
        this.s = new BN(s);
        this.recoveryParam = null;
        return true;
      };
      function constructLength(arr, len) {
        if (len < 128) {
          arr.push(len);
          return;
        }
        var octets = 1 + (Math.log(len) / Math.LN2 >>> 3);
        arr.push(octets | 128);
        while (--octets) {
          arr.push(len >>> (octets << 3) & 255);
        }
        arr.push(len);
      }
      Signature.prototype.toDER = function toDER(enc) {
        var r = this.r.toArray();
        var s = this.s.toArray();
        if (r[0] & 128)
          r = [0].concat(r);
        if (s[0] & 128)
          s = [0].concat(s);
        r = rmPadding(r);
        s = rmPadding(s);
        while (!s[0] && !(s[1] & 128)) {
          s = s.slice(1);
        }
        var arr = [2];
        constructLength(arr, r.length);
        arr = arr.concat(r);
        arr.push(2);
        constructLength(arr, s.length);
        var backHalf = arr.concat(s);
        var res = [48];
        constructLength(res, backHalf.length);
        res = res.concat(backHalf);
        return utils.encode(res, enc);
      };
    }
  });

  // node_modules/elliptic/lib/elliptic/ec/index.js
  var require_ec = __commonJS({
    "node_modules/elliptic/lib/elliptic/ec/index.js"(exports, module) {
      "use strict";
      var BN = require_bn();
      var HmacDRBG = require_hmac_drbg();
      var utils = require_utils2();
      var curves = require_curves();
      var rand = require_brorand();
      var assert2 = utils.assert;
      var KeyPair = require_key();
      var Signature = require_signature();
      function EC(options) {
        if (!(this instanceof EC))
          return new EC(options);
        if (typeof options === "string") {
          assert2(
              Object.prototype.hasOwnProperty.call(curves, options),
              "Unknown curve " + options
          );
          options = curves[options];
        }
        if (options instanceof curves.PresetCurve)
          options = { curve: options };
        this.curve = options.curve.curve;
        this.n = this.curve.n;
        this.nh = this.n.ushrn(1);
        this.g = this.curve.g;
        this.g = options.curve.g;
        this.g.precompute(options.curve.n.bitLength() + 1);
        this.hash = options.hash || options.curve.hash;
      }
      module.exports = EC;
      EC.prototype.keyPair = function keyPair(options) {
        return new KeyPair(this, options);
      };
      EC.prototype.keyFromPrivate = function keyFromPrivate(priv, enc) {
        return KeyPair.fromPrivate(this, priv, enc);
      };
      EC.prototype.keyFromPublic = function keyFromPublic(pub, enc) {
        return KeyPair.fromPublic(this, pub, enc);
      };
      EC.prototype.genKeyPair = function genKeyPair(options) {
        if (!options)
          options = {};
        var drbg = new HmacDRBG({
          hash: this.hash,
          pers: options.pers,
          persEnc: options.persEnc || "utf8",
          entropy: options.entropy || rand(this.hash.hmacStrength),
          entropyEnc: options.entropy && options.entropyEnc || "utf8",
          nonce: this.n.toArray()
        });
        var bytes2 = this.n.byteLength();
        var ns2 = this.n.sub(new BN(2));
        for (; ; ) {
          var priv = new BN(drbg.generate(bytes2));
          if (priv.cmp(ns2) > 0)
            continue;
          priv.iaddn(1);
          return this.keyFromPrivate(priv);
        }
      };
      EC.prototype._truncateToN = function _truncateToN(msg, truncOnly) {
        var delta = msg.byteLength() * 8 - this.n.bitLength();
        if (delta > 0)
          msg = msg.ushrn(delta);
        if (!truncOnly && msg.cmp(this.n) >= 0)
          return msg.sub(this.n);
        else
          return msg;
      };
      EC.prototype.sign = function sign(msg, key, enc, options) {
        if (typeof enc === "object") {
          options = enc;
          enc = null;
        }
        if (!options)
          options = {};
        key = this.keyFromPrivate(key, enc);
        msg = this._truncateToN(new BN(msg, 16));
        var bytes2 = this.n.byteLength();
        var bkey = key.getPrivate().toArray("be", bytes2);
        var nonce = msg.toArray("be", bytes2);
        var drbg = new HmacDRBG({
          hash: this.hash,
          entropy: bkey,
          nonce,
          pers: options.pers,
          persEnc: options.persEnc || "utf8"
        });
        var ns1 = this.n.sub(new BN(1));
        for (var iter = 0; ; iter++) {
          var k = options.k ? options.k(iter) : new BN(drbg.generate(this.n.byteLength()));
          k = this._truncateToN(k, true);
          if (k.cmpn(1) <= 0 || k.cmp(ns1) >= 0)
            continue;
          var kp = this.g.mul(k);
          if (kp.isInfinity())
            continue;
          var kpX = kp.getX();
          var r = kpX.umod(this.n);
          if (r.cmpn(0) === 0)
            continue;
          var s = k.invm(this.n).mul(r.mul(key.getPrivate()).iadd(msg));
          s = s.umod(this.n);
          if (s.cmpn(0) === 0)
            continue;
          var recoveryParam = (kp.getY().isOdd() ? 1 : 0) | (kpX.cmp(r) !== 0 ? 2 : 0);
          if (options.canonical && s.cmp(this.nh) > 0) {
            s = this.n.sub(s);
            recoveryParam ^= 1;
          }
          return new Signature({ r, s, recoveryParam });
        }
      };
      EC.prototype.verify = function verify(msg, signature, key, enc) {
        msg = this._truncateToN(new BN(msg, 16));
        key = this.keyFromPublic(key, enc);
        signature = new Signature(signature, "hex");
        var r = signature.r;
        var s = signature.s;
        if (r.cmpn(1) < 0 || r.cmp(this.n) >= 0)
          return false;
        if (s.cmpn(1) < 0 || s.cmp(this.n) >= 0)
          return false;
        var sinv = s.invm(this.n);
        var u1 = sinv.mul(msg).umod(this.n);
        var u2 = sinv.mul(r).umod(this.n);
        var p;
        if (!this.curve._maxwellTrick) {
          p = this.g.mulAdd(u1, key.getPublic(), u2);
          if (p.isInfinity())
            return false;
          return p.getX().umod(this.n).cmp(r) === 0;
        }
        p = this.g.jmulAdd(u1, key.getPublic(), u2);
        if (p.isInfinity())
          return false;
        return p.eqXToP(r);
      };
      EC.prototype.recoverPubKey = function(msg, signature, j, enc) {
        assert2((3 & j) === j, "The recovery param is more than two bits");
        signature = new Signature(signature, enc);
        var n = this.n;
        var e = new BN(msg);
        var r = signature.r;
        var s = signature.s;
        var isYOdd = j & 1;
        var isSecondKey = j >> 1;
        if (r.cmp(this.curve.p.umod(this.curve.n)) >= 0 && isSecondKey)
          throw new Error("Unable to find sencond key candinate");
        if (isSecondKey)
          r = this.curve.pointFromX(r.add(this.curve.n), isYOdd);
        else
          r = this.curve.pointFromX(r, isYOdd);
        var rInv = signature.r.invm(n);
        var s1 = n.sub(e).mul(rInv).umod(n);
        var s2 = s.mul(rInv).umod(n);
        return this.g.mulAdd(s1, r, s2);
      };
      EC.prototype.getKeyRecoveryParam = function(e, signature, Q, enc) {
        signature = new Signature(signature, enc);
        if (signature.recoveryParam !== null)
          return signature.recoveryParam;
        for (var i = 0; i < 4; i++) {
          var Qprime;
          try {
            Qprime = this.recoverPubKey(e, signature, i);
          } catch (e2) {
            continue;
          }
          if (Qprime.eq(Q))
            return i;
        }
        throw new Error("Unable to find valid recovery factor");
      };
    }
  });

  // node_modules/elliptic/lib/elliptic/eddsa/key.js
  var require_key2 = __commonJS({
    "node_modules/elliptic/lib/elliptic/eddsa/key.js"(exports, module) {
      "use strict";
      var utils = require_utils2();
      var assert2 = utils.assert;
      var parseBytes = utils.parseBytes;
      var cachedProperty = utils.cachedProperty;
      function KeyPair(eddsa, params) {
        this.eddsa = eddsa;
        this._secret = parseBytes(params.secret);
        if (eddsa.isPoint(params.pub))
          this._pub = params.pub;
        else
          this._pubBytes = parseBytes(params.pub);
      }
      KeyPair.fromPublic = function fromPublic(eddsa, pub) {
        if (pub instanceof KeyPair)
          return pub;
        return new KeyPair(eddsa, { pub });
      };
      KeyPair.fromSecret = function fromSecret(eddsa, secret) {
        if (secret instanceof KeyPair)
          return secret;
        return new KeyPair(eddsa, { secret });
      };
      KeyPair.prototype.secret = function secret() {
        return this._secret;
      };
      cachedProperty(KeyPair, "pubBytes", function pubBytes() {
        return this.eddsa.encodePoint(this.pub());
      });
      cachedProperty(KeyPair, "pub", function pub() {
        if (this._pubBytes)
          return this.eddsa.decodePoint(this._pubBytes);
        return this.eddsa.g.mul(this.priv());
      });
      cachedProperty(KeyPair, "privBytes", function privBytes() {
        var eddsa = this.eddsa;
        var hash3 = this.hash();
        var lastIx = eddsa.encodingLength - 1;
        var a = hash3.slice(0, eddsa.encodingLength);
        a[0] &= 248;
        a[lastIx] &= 127;
        a[lastIx] |= 64;
        return a;
      });
      cachedProperty(KeyPair, "priv", function priv() {
        return this.eddsa.decodeInt(this.privBytes());
      });
      cachedProperty(KeyPair, "hash", function hash3() {
        return this.eddsa.hash().update(this.secret()).digest();
      });
      cachedProperty(KeyPair, "messagePrefix", function messagePrefix() {
        return this.hash().slice(this.eddsa.encodingLength);
      });
      KeyPair.prototype.sign = function sign(message) {
        assert2(this._secret, "KeyPair can only verify");
        return this.eddsa.sign(message, this);
      };
      KeyPair.prototype.verify = function verify(message, sig) {
        return this.eddsa.verify(message, sig, this);
      };
      KeyPair.prototype.getSecret = function getSecret(enc) {
        assert2(this._secret, "KeyPair is public only");
        return utils.encode(this.secret(), enc);
      };
      KeyPair.prototype.getPublic = function getPublic(enc) {
        return utils.encode(this.pubBytes(), enc);
      };
      module.exports = KeyPair;
    }
  });

  // node_modules/elliptic/lib/elliptic/eddsa/signature.js
  var require_signature2 = __commonJS({
    "node_modules/elliptic/lib/elliptic/eddsa/signature.js"(exports, module) {
      "use strict";
      var BN = require_bn();
      var utils = require_utils2();
      var assert2 = utils.assert;
      var cachedProperty = utils.cachedProperty;
      var parseBytes = utils.parseBytes;
      function Signature(eddsa, sig) {
        this.eddsa = eddsa;
        if (typeof sig !== "object")
          sig = parseBytes(sig);
        if (Array.isArray(sig)) {
          sig = {
            R: sig.slice(0, eddsa.encodingLength),
            S: sig.slice(eddsa.encodingLength)
          };
        }
        assert2(sig.R && sig.S, "Signature without R or S");
        if (eddsa.isPoint(sig.R))
          this._R = sig.R;
        if (sig.S instanceof BN)
          this._S = sig.S;
        this._Rencoded = Array.isArray(sig.R) ? sig.R : sig.Rencoded;
        this._Sencoded = Array.isArray(sig.S) ? sig.S : sig.Sencoded;
      }
      cachedProperty(Signature, "S", function S() {
        return this.eddsa.decodeInt(this.Sencoded());
      });
      cachedProperty(Signature, "R", function R() {
        return this.eddsa.decodePoint(this.Rencoded());
      });
      cachedProperty(Signature, "Rencoded", function Rencoded() {
        return this.eddsa.encodePoint(this.R());
      });
      cachedProperty(Signature, "Sencoded", function Sencoded() {
        return this.eddsa.encodeInt(this.S());
      });
      Signature.prototype.toBytes = function toBytes2() {
        return this.Rencoded().concat(this.Sencoded());
      };
      Signature.prototype.toHex = function toHex() {
        return utils.encode(this.toBytes(), "hex").toUpperCase();
      };
      module.exports = Signature;
    }
  });

  // node_modules/elliptic/lib/elliptic/eddsa/index.js
  var require_eddsa = __commonJS({
    "node_modules/elliptic/lib/elliptic/eddsa/index.js"(exports, module) {
      "use strict";
      var hash3 = require_hash();
      var curves = require_curves();
      var utils = require_utils2();
      var assert2 = utils.assert;
      var parseBytes = utils.parseBytes;
      var KeyPair = require_key2();
      var Signature = require_signature2();
      function EDDSA(curve) {
        assert2(curve === "ed25519", "only tested with ed25519 so far");
        if (!(this instanceof EDDSA))
          return new EDDSA(curve);
        curve = curves[curve].curve;
        this.curve = curve;
        this.g = curve.g;
        this.g.precompute(curve.n.bitLength() + 1);
        this.pointClass = curve.point().constructor;
        this.encodingLength = Math.ceil(curve.n.bitLength() / 8);
        this.hash = hash3.sha512;
      }
      module.exports = EDDSA;
      EDDSA.prototype.sign = function sign(message, secret) {
        message = parseBytes(message);
        var key = this.keyFromSecret(secret);
        var r = this.hashInt(key.messagePrefix(), message);
        var R = this.g.mul(r);
        var Rencoded = this.encodePoint(R);
        var s_ = this.hashInt(Rencoded, key.pubBytes(), message).mul(key.priv());
        var S = r.add(s_).umod(this.curve.n);
        return this.makeSignature({ R, S, Rencoded });
      };
      EDDSA.prototype.verify = function verify(message, sig, pub) {
        message = parseBytes(message);
        sig = this.makeSignature(sig);
        var key = this.keyFromPublic(pub);
        var h = this.hashInt(sig.Rencoded(), key.pubBytes(), message);
        var SG = this.g.mul(sig.S());
        var RplusAh = sig.R().add(key.pub().mul(h));
        return RplusAh.eq(SG);
      };
      EDDSA.prototype.hashInt = function hashInt() {
        var hash4 = this.hash();
        for (var i = 0; i < arguments.length; i++)
          hash4.update(arguments[i]);
        return utils.intFromLE(hash4.digest()).umod(this.curve.n);
      };
      EDDSA.prototype.keyFromPublic = function keyFromPublic(pub) {
        return KeyPair.fromPublic(this, pub);
      };
      EDDSA.prototype.keyFromSecret = function keyFromSecret(secret) {
        return KeyPair.fromSecret(this, secret);
      };
      EDDSA.prototype.makeSignature = function makeSignature(sig) {
        if (sig instanceof Signature)
          return sig;
        return new Signature(this, sig);
      };
      EDDSA.prototype.encodePoint = function encodePoint(point) {
        var enc = point.getY().toArray("le", this.encodingLength);
        enc[this.encodingLength - 1] |= point.getX().isOdd() ? 128 : 0;
        return enc;
      };
      EDDSA.prototype.decodePoint = function decodePoint(bytes2) {
        bytes2 = utils.parseBytes(bytes2);
        var lastIx = bytes2.length - 1;
        var normed = bytes2.slice(0, lastIx).concat(bytes2[lastIx] & ~128);
        var xIsOdd = (bytes2[lastIx] & 128) !== 0;
        var y = utils.intFromLE(normed);
        return this.curve.pointFromY(y, xIsOdd);
      };
      EDDSA.prototype.encodeInt = function encodeInt(num) {
        return num.toArray("le", this.encodingLength);
      };
      EDDSA.prototype.decodeInt = function decodeInt(bytes2) {
        return utils.intFromLE(bytes2);
      };
      EDDSA.prototype.isPoint = function isPoint(val) {
        return val instanceof this.pointClass;
      };
    }
  });

  // node_modules/elliptic/lib/elliptic.js
  var require_elliptic = __commonJS({
    "node_modules/elliptic/lib/elliptic.js"(exports) {
      "use strict";
      var elliptic2 = exports;
      elliptic2.version = require_package().version;
      elliptic2.utils = require_utils2();
      elliptic2.rand = require_brorand();
      elliptic2.curve = require_curve();
      elliptic2.curves = require_curves();
      elliptic2.ec = require_ec();
      elliptic2.eddsa = require_eddsa();
    }
  });

  // node_modules/@stablelib/int/lib/int.js
  var require_int = __commonJS({
    "node_modules/@stablelib/int/lib/int.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      function imulShim(a, b) {
        var ah = a >>> 16 & 65535, al = a & 65535;
        var bh = b >>> 16 & 65535, bl = b & 65535;
        return al * bl + (ah * bl + al * bh << 16 >>> 0) | 0;
      }
      exports.mul = Math.imul || imulShim;
      function add2(a, b) {
        return a + b | 0;
      }
      exports.add = add2;
      function sub(a, b) {
        return a - b | 0;
      }
      exports.sub = sub;
      function rotl(x, n) {
        return x << n | x >>> 32 - n;
      }
      exports.rotl = rotl;
      function rotr2(x, n) {
        return x << 32 - n | x >>> n;
      }
      exports.rotr = rotr2;
      function isIntegerShim(n) {
        return typeof n === "number" && isFinite(n) && Math.floor(n) === n;
      }
      exports.isInteger = Number.isInteger || isIntegerShim;
      exports.MAX_SAFE_INTEGER = 9007199254740991;
      exports.isSafeInteger = function(n) {
        return exports.isInteger(n) && (n >= -exports.MAX_SAFE_INTEGER && n <= exports.MAX_SAFE_INTEGER);
      };
    }
  });

  // node_modules/@stablelib/binary/lib/binary.js
  var require_binary = __commonJS({
    "node_modules/@stablelib/binary/lib/binary.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var int_1 = require_int();
      function readInt16BE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        return (array2[offset + 0] << 8 | array2[offset + 1]) << 16 >> 16;
      }
      exports.readInt16BE = readInt16BE;
      function readUint16BE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        return (array2[offset + 0] << 8 | array2[offset + 1]) >>> 0;
      }
      exports.readUint16BE = readUint16BE;
      function readInt16LE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        return (array2[offset + 1] << 8 | array2[offset]) << 16 >> 16;
      }
      exports.readInt16LE = readInt16LE;
      function readUint16LE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        return (array2[offset + 1] << 8 | array2[offset]) >>> 0;
      }
      exports.readUint16LE = readUint16LE;
      function writeUint16BE(value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(2);
        }
        if (offset === void 0) {
          offset = 0;
        }
        out[offset + 0] = value >>> 8;
        out[offset + 1] = value >>> 0;
        return out;
      }
      exports.writeUint16BE = writeUint16BE;
      exports.writeInt16BE = writeUint16BE;
      function writeUint16LE(value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(2);
        }
        if (offset === void 0) {
          offset = 0;
        }
        out[offset + 0] = value >>> 0;
        out[offset + 1] = value >>> 8;
        return out;
      }
      exports.writeUint16LE = writeUint16LE;
      exports.writeInt16LE = writeUint16LE;
      function readInt32BE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        return array2[offset] << 24 | array2[offset + 1] << 16 | array2[offset + 2] << 8 | array2[offset + 3];
      }
      exports.readInt32BE = readInt32BE;
      function readUint32BE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        return (array2[offset] << 24 | array2[offset + 1] << 16 | array2[offset + 2] << 8 | array2[offset + 3]) >>> 0;
      }
      exports.readUint32BE = readUint32BE;
      function readInt32LE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        return array2[offset + 3] << 24 | array2[offset + 2] << 16 | array2[offset + 1] << 8 | array2[offset];
      }
      exports.readInt32LE = readInt32LE;
      function readUint32LE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        return (array2[offset + 3] << 24 | array2[offset + 2] << 16 | array2[offset + 1] << 8 | array2[offset]) >>> 0;
      }
      exports.readUint32LE = readUint32LE;
      function writeUint32BE(value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(4);
        }
        if (offset === void 0) {
          offset = 0;
        }
        out[offset + 0] = value >>> 24;
        out[offset + 1] = value >>> 16;
        out[offset + 2] = value >>> 8;
        out[offset + 3] = value >>> 0;
        return out;
      }
      exports.writeUint32BE = writeUint32BE;
      exports.writeInt32BE = writeUint32BE;
      function writeUint32LE(value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(4);
        }
        if (offset === void 0) {
          offset = 0;
        }
        out[offset + 0] = value >>> 0;
        out[offset + 1] = value >>> 8;
        out[offset + 2] = value >>> 16;
        out[offset + 3] = value >>> 24;
        return out;
      }
      exports.writeUint32LE = writeUint32LE;
      exports.writeInt32LE = writeUint32LE;
      function readInt64BE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        var hi = readInt32BE(array2, offset);
        var lo = readInt32BE(array2, offset + 4);
        return hi * 4294967296 + lo - (lo >> 31) * 4294967296;
      }
      exports.readInt64BE = readInt64BE;
      function readUint64BE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        var hi = readUint32BE(array2, offset);
        var lo = readUint32BE(array2, offset + 4);
        return hi * 4294967296 + lo;
      }
      exports.readUint64BE = readUint64BE;
      function readInt64LE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        var lo = readInt32LE(array2, offset);
        var hi = readInt32LE(array2, offset + 4);
        return hi * 4294967296 + lo - (lo >> 31) * 4294967296;
      }
      exports.readInt64LE = readInt64LE;
      function readUint64LE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        var lo = readUint32LE(array2, offset);
        var hi = readUint32LE(array2, offset + 4);
        return hi * 4294967296 + lo;
      }
      exports.readUint64LE = readUint64LE;
      function writeUint64BE(value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(8);
        }
        if (offset === void 0) {
          offset = 0;
        }
        writeUint32BE(value / 4294967296 >>> 0, out, offset);
        writeUint32BE(value >>> 0, out, offset + 4);
        return out;
      }
      exports.writeUint64BE = writeUint64BE;
      exports.writeInt64BE = writeUint64BE;
      function writeUint64LE(value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(8);
        }
        if (offset === void 0) {
          offset = 0;
        }
        writeUint32LE(value >>> 0, out, offset);
        writeUint32LE(value / 4294967296 >>> 0, out, offset + 4);
        return out;
      }
      exports.writeUint64LE = writeUint64LE;
      exports.writeInt64LE = writeUint64LE;
      function readUintBE(bitLength, array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        if (bitLength % 8 !== 0) {
          throw new Error("readUintBE supports only bitLengths divisible by 8");
        }
        if (bitLength / 8 > array2.length - offset) {
          throw new Error("readUintBE: array is too short for the given bitLength");
        }
        var result = 0;
        var mul = 1;
        for (var i = bitLength / 8 + offset - 1; i >= offset; i--) {
          result += array2[i] * mul;
          mul *= 256;
        }
        return result;
      }
      exports.readUintBE = readUintBE;
      function readUintLE(bitLength, array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        if (bitLength % 8 !== 0) {
          throw new Error("readUintLE supports only bitLengths divisible by 8");
        }
        if (bitLength / 8 > array2.length - offset) {
          throw new Error("readUintLE: array is too short for the given bitLength");
        }
        var result = 0;
        var mul = 1;
        for (var i = offset; i < offset + bitLength / 8; i++) {
          result += array2[i] * mul;
          mul *= 256;
        }
        return result;
      }
      exports.readUintLE = readUintLE;
      function writeUintBE(bitLength, value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(bitLength / 8);
        }
        if (offset === void 0) {
          offset = 0;
        }
        if (bitLength % 8 !== 0) {
          throw new Error("writeUintBE supports only bitLengths divisible by 8");
        }
        if (!int_1.isSafeInteger(value)) {
          throw new Error("writeUintBE value must be an integer");
        }
        var div = 1;
        for (var i = bitLength / 8 + offset - 1; i >= offset; i--) {
          out[i] = value / div & 255;
          div *= 256;
        }
        return out;
      }
      exports.writeUintBE = writeUintBE;
      function writeUintLE(bitLength, value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(bitLength / 8);
        }
        if (offset === void 0) {
          offset = 0;
        }
        if (bitLength % 8 !== 0) {
          throw new Error("writeUintLE supports only bitLengths divisible by 8");
        }
        if (!int_1.isSafeInteger(value)) {
          throw new Error("writeUintLE value must be an integer");
        }
        var div = 1;
        for (var i = offset; i < offset + bitLength / 8; i++) {
          out[i] = value / div & 255;
          div *= 256;
        }
        return out;
      }
      exports.writeUintLE = writeUintLE;
      function readFloat32BE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        var view = new DataView(array2.buffer, array2.byteOffset, array2.byteLength);
        return view.getFloat32(offset);
      }
      exports.readFloat32BE = readFloat32BE;
      function readFloat32LE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        var view = new DataView(array2.buffer, array2.byteOffset, array2.byteLength);
        return view.getFloat32(offset, true);
      }
      exports.readFloat32LE = readFloat32LE;
      function readFloat64BE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        var view = new DataView(array2.buffer, array2.byteOffset, array2.byteLength);
        return view.getFloat64(offset);
      }
      exports.readFloat64BE = readFloat64BE;
      function readFloat64LE(array2, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        var view = new DataView(array2.buffer, array2.byteOffset, array2.byteLength);
        return view.getFloat64(offset, true);
      }
      exports.readFloat64LE = readFloat64LE;
      function writeFloat32BE(value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(4);
        }
        if (offset === void 0) {
          offset = 0;
        }
        var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
        view.setFloat32(offset, value);
        return out;
      }
      exports.writeFloat32BE = writeFloat32BE;
      function writeFloat32LE(value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(4);
        }
        if (offset === void 0) {
          offset = 0;
        }
        var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
        view.setFloat32(offset, value, true);
        return out;
      }
      exports.writeFloat32LE = writeFloat32LE;
      function writeFloat64BE(value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(8);
        }
        if (offset === void 0) {
          offset = 0;
        }
        var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
        view.setFloat64(offset, value);
        return out;
      }
      exports.writeFloat64BE = writeFloat64BE;
      function writeFloat64LE(value, out, offset) {
        if (out === void 0) {
          out = new Uint8Array(8);
        }
        if (offset === void 0) {
          offset = 0;
        }
        var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
        view.setFloat64(offset, value, true);
        return out;
      }
      exports.writeFloat64LE = writeFloat64LE;
    }
  });

  // node_modules/@stablelib/wipe/lib/wipe.js
  var require_wipe = __commonJS({
    "node_modules/@stablelib/wipe/lib/wipe.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      function wipe(array2) {
        for (var i = 0; i < array2.length; i++) {
          array2[i] = 0;
        }
        return array2;
      }
      exports.wipe = wipe;
    }
  });

  // node_modules/@stablelib/sha256/lib/sha256.js
  var require_sha256 = __commonJS({
    "node_modules/@stablelib/sha256/lib/sha256.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var binary_1 = require_binary();
      var wipe_1 = require_wipe();
      exports.DIGEST_LENGTH = 32;
      exports.BLOCK_SIZE = 64;
      var SHA2562 = (
          /** @class */
          function() {
            function SHA2563() {
              this.digestLength = exports.DIGEST_LENGTH;
              this.blockSize = exports.BLOCK_SIZE;
              this._state = new Int32Array(8);
              this._temp = new Int32Array(64);
              this._buffer = new Uint8Array(128);
              this._bufferLength = 0;
              this._bytesHashed = 0;
              this._finished = false;
              this.reset();
            }
            SHA2563.prototype._initState = function() {
              this._state[0] = 1779033703;
              this._state[1] = 3144134277;
              this._state[2] = 1013904242;
              this._state[3] = 2773480762;
              this._state[4] = 1359893119;
              this._state[5] = 2600822924;
              this._state[6] = 528734635;
              this._state[7] = 1541459225;
            };
            SHA2563.prototype.reset = function() {
              this._initState();
              this._bufferLength = 0;
              this._bytesHashed = 0;
              this._finished = false;
              return this;
            };
            SHA2563.prototype.clean = function() {
              wipe_1.wipe(this._buffer);
              wipe_1.wipe(this._temp);
              this.reset();
            };
            SHA2563.prototype.update = function(data, dataLength) {
              if (dataLength === void 0) {
                dataLength = data.length;
              }
              if (this._finished) {
                throw new Error("SHA256: can't update because hash was finished.");
              }
              var dataPos = 0;
              this._bytesHashed += dataLength;
              if (this._bufferLength > 0) {
                while (this._bufferLength < this.blockSize && dataLength > 0) {
                  this._buffer[this._bufferLength++] = data[dataPos++];
                  dataLength--;
                }
                if (this._bufferLength === this.blockSize) {
                  hashBlocks(this._temp, this._state, this._buffer, 0, this.blockSize);
                  this._bufferLength = 0;
                }
              }
              if (dataLength >= this.blockSize) {
                dataPos = hashBlocks(this._temp, this._state, data, dataPos, dataLength);
                dataLength %= this.blockSize;
              }
              while (dataLength > 0) {
                this._buffer[this._bufferLength++] = data[dataPos++];
                dataLength--;
              }
              return this;
            };
            SHA2563.prototype.finish = function(out) {
              if (!this._finished) {
                var bytesHashed = this._bytesHashed;
                var left = this._bufferLength;
                var bitLenHi = bytesHashed / 536870912 | 0;
                var bitLenLo = bytesHashed << 3;
                var padLength = bytesHashed % 64 < 56 ? 64 : 128;
                this._buffer[left] = 128;
                for (var i = left + 1; i < padLength - 8; i++) {
                  this._buffer[i] = 0;
                }
                binary_1.writeUint32BE(bitLenHi, this._buffer, padLength - 8);
                binary_1.writeUint32BE(bitLenLo, this._buffer, padLength - 4);
                hashBlocks(this._temp, this._state, this._buffer, 0, padLength);
                this._finished = true;
              }
              for (var i = 0; i < this.digestLength / 4; i++) {
                binary_1.writeUint32BE(this._state[i], out, i * 4);
              }
              return this;
            };
            SHA2563.prototype.digest = function() {
              var out = new Uint8Array(this.digestLength);
              this.finish(out);
              return out;
            };
            SHA2563.prototype.saveState = function() {
              if (this._finished) {
                throw new Error("SHA256: cannot save finished state");
              }
              return {
                state: new Int32Array(this._state),
                buffer: this._bufferLength > 0 ? new Uint8Array(this._buffer) : void 0,
                bufferLength: this._bufferLength,
                bytesHashed: this._bytesHashed
              };
            };
            SHA2563.prototype.restoreState = function(savedState) {
              this._state.set(savedState.state);
              this._bufferLength = savedState.bufferLength;
              if (savedState.buffer) {
                this._buffer.set(savedState.buffer);
              }
              this._bytesHashed = savedState.bytesHashed;
              this._finished = false;
              return this;
            };
            SHA2563.prototype.cleanSavedState = function(savedState) {
              wipe_1.wipe(savedState.state);
              if (savedState.buffer) {
                wipe_1.wipe(savedState.buffer);
              }
              savedState.bufferLength = 0;
              savedState.bytesHashed = 0;
            };
            return SHA2563;
          }()
      );
      exports.SHA256 = SHA2562;
      var K = new Int32Array([
        1116352408,
        1899447441,
        3049323471,
        3921009573,
        961987163,
        1508970993,
        2453635748,
        2870763221,
        3624381080,
        310598401,
        607225278,
        1426881987,
        1925078388,
        2162078206,
        2614888103,
        3248222580,
        3835390401,
        4022224774,
        264347078,
        604807628,
        770255983,
        1249150122,
        1555081692,
        1996064986,
        2554220882,
        2821834349,
        2952996808,
        3210313671,
        3336571891,
        3584528711,
        113926993,
        338241895,
        666307205,
        773529912,
        1294757372,
        1396182291,
        1695183700,
        1986661051,
        2177026350,
        2456956037,
        2730485921,
        2820302411,
        3259730800,
        3345764771,
        3516065817,
        3600352804,
        4094571909,
        275423344,
        430227734,
        506948616,
        659060556,
        883997877,
        958139571,
        1322822218,
        1537002063,
        1747873779,
        1955562222,
        2024104815,
        2227730452,
        2361852424,
        2428436474,
        2756734187,
        3204031479,
        3329325298
      ]);
      function hashBlocks(w, v, p, pos, len) {
        while (len >= 64) {
          var a = v[0];
          var b = v[1];
          var c = v[2];
          var d = v[3];
          var e = v[4];
          var f = v[5];
          var g = v[6];
          var h = v[7];
          for (var i = 0; i < 16; i++) {
            var j = pos + i * 4;
            w[i] = binary_1.readUint32BE(p, j);
          }
          for (var i = 16; i < 64; i++) {
            var u = w[i - 2];
            var t1 = (u >>> 17 | u << 32 - 17) ^ (u >>> 19 | u << 32 - 19) ^ u >>> 10;
            u = w[i - 15];
            var t2 = (u >>> 7 | u << 32 - 7) ^ (u >>> 18 | u << 32 - 18) ^ u >>> 3;
            w[i] = (t1 + w[i - 7] | 0) + (t2 + w[i - 16] | 0);
          }
          for (var i = 0; i < 64; i++) {
            var t1 = (((e >>> 6 | e << 32 - 6) ^ (e >>> 11 | e << 32 - 11) ^ (e >>> 25 | e << 32 - 25)) + (e & f ^ ~e & g) | 0) + (h + (K[i] + w[i] | 0) | 0) | 0;
            var t2 = ((a >>> 2 | a << 32 - 2) ^ (a >>> 13 | a << 32 - 13) ^ (a >>> 22 | a << 32 - 22)) + (a & b ^ a & c ^ b & c) | 0;
            h = g;
            g = f;
            f = e;
            e = d + t1 | 0;
            d = c;
            c = b;
            b = a;
            a = t1 + t2 | 0;
          }
          v[0] += a;
          v[1] += b;
          v[2] += c;
          v[3] += d;
          v[4] += e;
          v[5] += f;
          v[6] += g;
          v[7] += h;
          pos += 64;
          len -= 64;
        }
        return pos;
      }
      function hash3(data) {
        var h = new SHA2562();
        h.update(data);
        var digest3 = h.digest();
        h.clean();
        return digest3;
      }
      exports.hash = hash3;
    }
  });

  // node_modules/varint/encode.js
  var require_encode = __commonJS({
    "node_modules/varint/encode.js"(exports, module) {
      module.exports = encode14;
      var MSB4 = 128;
      var REST4 = 127;
      var MSBALL4 = ~REST4;
      var INT4 = Math.pow(2, 31);
      function encode14(num, out, offset) {
        if (Number.MAX_SAFE_INTEGER && num > Number.MAX_SAFE_INTEGER) {
          encode14.bytes = 0;
          throw new RangeError("Could not encode varint");
        }
        out = out || [];
        offset = offset || 0;
        var oldOffset = offset;
        while (num >= INT4) {
          out[offset++] = num & 255 | MSB4;
          num /= 128;
        }
        while (num & MSBALL4) {
          out[offset++] = num & 255 | MSB4;
          num >>>= 7;
        }
        out[offset] = num | 0;
        encode14.bytes = offset - oldOffset + 1;
        return out;
      }
    }
  });

  // node_modules/varint/decode.js
  var require_decode = __commonJS({
    "node_modules/varint/decode.js"(exports, module) {
      module.exports = read4;
      var MSB4 = 128;
      var REST4 = 127;
      function read4(buf2, offset) {
        var res = 0, offset = offset || 0, shift = 0, counter = offset, b, l = buf2.length;
        do {
          if (counter >= l || shift > 49) {
            read4.bytes = 0;
            throw new RangeError("Could not decode varint");
          }
          b = buf2[counter++];
          res += shift < 28 ? (b & REST4) << shift : (b & REST4) * Math.pow(2, shift);
          shift += 7;
        } while (b >= MSB4);
        read4.bytes = counter - offset;
        return res;
      }
    }
  });

  // node_modules/varint/length.js
  var require_length = __commonJS({
    "node_modules/varint/length.js"(exports, module) {
      var N14 = Math.pow(2, 7);
      var N24 = Math.pow(2, 14);
      var N34 = Math.pow(2, 21);
      var N44 = Math.pow(2, 28);
      var N54 = Math.pow(2, 35);
      var N64 = Math.pow(2, 42);
      var N74 = Math.pow(2, 49);
      var N84 = Math.pow(2, 56);
      var N94 = Math.pow(2, 63);
      module.exports = function(value) {
        return value < N14 ? 1 : value < N24 ? 2 : value < N34 ? 3 : value < N44 ? 4 : value < N54 ? 5 : value < N64 ? 6 : value < N74 ? 7 : value < N84 ? 8 : value < N94 ? 9 : 10;
      };
    }
  });

  // node_modules/varint/index.js
  var require_varint = __commonJS({
    "node_modules/varint/index.js"(exports, module) {
      module.exports = {
        encode: require_encode(),
        decode: require_decode(),
        encodingLength: require_length()
      };
    }
  });

  // node_modules/property-expr/index.js
  var require_property_expr = __commonJS({
    "node_modules/property-expr/index.js"(exports, module) {
      "use strict";
      function Cache(maxSize) {
        this._maxSize = maxSize;
        this.clear();
      }
      Cache.prototype.clear = function() {
        this._size = 0;
        this._values = /* @__PURE__ */ Object.create(null);
      };
      Cache.prototype.get = function(key) {
        return this._values[key];
      };
      Cache.prototype.set = function(key, value) {
        this._size >= this._maxSize && this.clear();
        if (!(key in this._values))
          this._size++;
        return this._values[key] = value;
      };
      var SPLIT_REGEX = /[^.^\]^[]+|(?=\[\]|\.\.)/g;
      var DIGIT_REGEX = /^\d+$/;
      var LEAD_DIGIT_REGEX = /^\d/;
      var SPEC_CHAR_REGEX = /[~`!#$%\^&*+=\-\[\]\\';,/{}|\\":<>\?]/g;
      var CLEAN_QUOTES_REGEX = /^\s*(['"]?)(.*?)(\1)\s*$/;
      var MAX_CACHE_SIZE = 512;
      var pathCache = new Cache(MAX_CACHE_SIZE);
      var setCache = new Cache(MAX_CACHE_SIZE);
      var getCache = new Cache(MAX_CACHE_SIZE);
      module.exports = {
        Cache,
        split: split3,
        normalizePath: normalizePath2,
        setter: function(path) {
          var parts = normalizePath2(path);
          return setCache.get(path) || setCache.set(path, function setter(obj, value) {
            var index = 0;
            var len = parts.length;
            var data = obj;
            while (index < len - 1) {
              var part = parts[index];
              if (part === "__proto__" || part === "constructor" || part === "prototype") {
                return obj;
              }
              data = data[parts[index++]];
            }
            data[parts[index]] = value;
          });
        },
        getter: function(path, safe) {
          var parts = normalizePath2(path);
          return getCache.get(path) || getCache.set(path, function getter2(data) {
            var index = 0, len = parts.length;
            while (index < len) {
              if (data != null || !safe)
                data = data[parts[index++]];
              else
                return;
            }
            return data;
          });
        },
        join: function(segments) {
          return segments.reduce(function(path, part) {
            return path + (isQuoted(part) || DIGIT_REGEX.test(part) ? "[" + part + "]" : (path ? "." : "") + part);
          }, "");
        },
        forEach: function(path, cb, thisArg) {
          forEach2(Array.isArray(path) ? path : split3(path), cb, thisArg);
        }
      };
      function normalizePath2(path) {
        return pathCache.get(path) || pathCache.set(
            path,
            split3(path).map(function(part) {
              return part.replace(CLEAN_QUOTES_REGEX, "$2");
            })
        );
      }
      function split3(path) {
        return path.match(SPLIT_REGEX) || [""];
      }
      function forEach2(parts, iter, thisArg) {
        var len = parts.length, part, idx, isArray, isBracket;
        for (idx = 0; idx < len; idx++) {
          part = parts[idx];
          if (part) {
            if (shouldBeQuoted(part)) {
              part = '"' + part + '"';
            }
            isBracket = isQuoted(part);
            isArray = !isBracket && /^\d+$/.test(part);
            iter.call(thisArg, part, isBracket, isArray, idx, parts);
          }
        }
      }
      function isQuoted(str) {
        return typeof str === "string" && str && ["'", '"'].indexOf(str.charAt(0)) !== -1;
      }
      function hasLeadingNumber(part) {
        return part.match(LEAD_DIGIT_REGEX) && !part.match(DIGIT_REGEX);
      }
      function hasSpecialChars(part) {
        return SPEC_CHAR_REGEX.test(part);
      }
      function shouldBeQuoted(part) {
        return !isQuoted(part) && (hasLeadingNumber(part) || hasSpecialChars(part));
      }
    }
  });

  // node_modules/tiny-case/index.js
  var require_tiny_case = __commonJS({
    "node_modules/tiny-case/index.js"(exports, module) {
      var reWords = /[A-Z\xc0-\xd6\xd8-\xde]?[a-z\xdf-\xf6\xf8-\xff]+(?:['’](?:d|ll|m|re|s|t|ve))?(?=[\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000]|[A-Z\xc0-\xd6\xd8-\xde]|$)|(?:[A-Z\xc0-\xd6\xd8-\xde]|[^\ud800-\udfff\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\d+\u2700-\u27bfa-z\xdf-\xf6\xf8-\xffA-Z\xc0-\xd6\xd8-\xde])+(?:['’](?:D|LL|M|RE|S|T|VE))?(?=[\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000]|[A-Z\xc0-\xd6\xd8-\xde](?:[a-z\xdf-\xf6\xf8-\xff]|[^\ud800-\udfff\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\d+\u2700-\u27bfa-z\xdf-\xf6\xf8-\xffA-Z\xc0-\xd6\xd8-\xde])|$)|[A-Z\xc0-\xd6\xd8-\xde]?(?:[a-z\xdf-\xf6\xf8-\xff]|[^\ud800-\udfff\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\d+\u2700-\u27bfa-z\xdf-\xf6\xf8-\xffA-Z\xc0-\xd6\xd8-\xde])+(?:['’](?:d|ll|m|re|s|t|ve))?|[A-Z\xc0-\xd6\xd8-\xde]+(?:['’](?:D|LL|M|RE|S|T|VE))?|\d*(?:1ST|2ND|3RD|(?![123])\dTH)(?=\b|[a-z_])|\d*(?:1st|2nd|3rd|(?![123])\dth)(?=\b|[A-Z_])|\d+|(?:[\u2700-\u27bf]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff])[\ufe0e\ufe0f]?(?:[\u0300-\u036f\ufe20-\ufe2f\u20d0-\u20ff]|\ud83c[\udffb-\udfff])?(?:\u200d(?:[^\ud800-\udfff]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff])[\ufe0e\ufe0f]?(?:[\u0300-\u036f\ufe20-\ufe2f\u20d0-\u20ff]|\ud83c[\udffb-\udfff])?)*/g;
      var words = (str) => str.match(reWords) || [];
      var upperFirst = (str) => str[0].toUpperCase() + str.slice(1);
      var join2 = (str, d) => words(str).join(d).toLowerCase();
      var camelCase2 = (str) => words(str).reduce(
          (acc, next) => `${acc}${!acc ? next.toLowerCase() : next[0].toUpperCase() + next.slice(1).toLowerCase()}`,
          ""
      );
      var pascalCase = (str) => upperFirst(camelCase2(str));
      var snakeCase2 = (str) => join2(str, "_");
      var kebabCase = (str) => join2(str, "-");
      var sentenceCase = (str) => upperFirst(join2(str, " "));
      var titleCase = (str) => words(str).map(upperFirst).join(" ");
      module.exports = {
        words,
        upperFirst,
        camelCase: camelCase2,
        pascalCase,
        snakeCase: snakeCase2,
        kebabCase,
        sentenceCase,
        titleCase
      };
    }
  });

  // node_modules/toposort/index.js
  var require_toposort = __commonJS({
    "node_modules/toposort/index.js"(exports, module) {
      module.exports = function(edges) {
        return toposort2(uniqueNodes(edges), edges);
      };
      module.exports.array = toposort2;
      function toposort2(nodes, edges) {
        var cursor = nodes.length, sorted = new Array(cursor), visited = {}, i = cursor, outgoingEdges = makeOutgoingEdges(edges), nodesHash = makeNodesHash(nodes);
        edges.forEach(function(edge) {
          if (!nodesHash.has(edge[0]) || !nodesHash.has(edge[1])) {
            throw new Error("Unknown node. There is an unknown node in the supplied edges.");
          }
        });
        while (i--) {
          if (!visited[i])
            visit(nodes[i], i, /* @__PURE__ */ new Set());
        }
        return sorted;
        function visit(node, i2, predecessors) {
          if (predecessors.has(node)) {
            var nodeRep;
            try {
              nodeRep = ", node was:" + JSON.stringify(node);
            } catch (e) {
              nodeRep = "";
            }
            throw new Error("Cyclic dependency" + nodeRep);
          }
          if (!nodesHash.has(node)) {
            throw new Error("Found unknown node. Make sure to provided all involved nodes. Unknown node: " + JSON.stringify(node));
          }
          if (visited[i2])
            return;
          visited[i2] = true;
          var outgoing = outgoingEdges.get(node) || /* @__PURE__ */ new Set();
          outgoing = Array.from(outgoing);
          if (i2 = outgoing.length) {
            predecessors.add(node);
            do {
              var child = outgoing[--i2];
              visit(child, nodesHash.get(child), predecessors);
            } while (i2);
            predecessors.delete(node);
          }
          sorted[--cursor] = node;
        }
      }
      function uniqueNodes(arr) {
        var res = /* @__PURE__ */ new Set();
        for (var i = 0, len = arr.length; i < len; i++) {
          var edge = arr[i];
          res.add(edge[0]);
          res.add(edge[1]);
        }
        return Array.from(res);
      }
      function makeOutgoingEdges(arr) {
        var edges = /* @__PURE__ */ new Map();
        for (var i = 0, len = arr.length; i < len; i++) {
          var edge = arr[i];
          if (!edges.has(edge[0]))
            edges.set(edge[0], /* @__PURE__ */ new Set());
          if (!edges.has(edge[1]))
            edges.set(edge[1], /* @__PURE__ */ new Set());
          edges.get(edge[0]).add(edge[1]);
        }
        return edges;
      }
      function makeNodesHash(arr) {
        var res = /* @__PURE__ */ new Map();
        for (var i = 0, len = arr.length; i < len; i++) {
          res.set(arr[i], i);
        }
        return res;
      }
    }
  });

  // node_modules/uint8arrays/esm/src/util/as-uint8array.js
  function asUint8Array(buf2) {
    if (globalThis.Buffer != null) {
      return new Uint8Array(buf2.buffer, buf2.byteOffset, buf2.byteLength);
    }
    return buf2;
  }

  // node_modules/uint8arrays/esm/src/alloc.js
  function allocUnsafe(size = 0) {
    if (globalThis.Buffer != null && globalThis.Buffer.allocUnsafe != null) {
      return asUint8Array(globalThis.Buffer.allocUnsafe(size));
    }
    return new Uint8Array(size);
  }

  // node_modules/multiformats/esm/src/bases/identity.js
  var identity_exports = {};
  __export(identity_exports, {
    identity: () => identity
  });

  // node_modules/multiformats/esm/vendor/base-x.js
  function base(ALPHABET, name4) {
    if (ALPHABET.length >= 255) {
      throw new TypeError("Alphabet too long");
    }
    var BASE_MAP = new Uint8Array(256);
    for (var j = 0; j < BASE_MAP.length; j++) {
      BASE_MAP[j] = 255;
    }
    for (var i = 0; i < ALPHABET.length; i++) {
      var x = ALPHABET.charAt(i);
      var xc = x.charCodeAt(0);
      if (BASE_MAP[xc] !== 255) {
        throw new TypeError(x + " is ambiguous");
      }
      BASE_MAP[xc] = i;
    }
    var BASE = ALPHABET.length;
    var LEADER = ALPHABET.charAt(0);
    var FACTOR = Math.log(BASE) / Math.log(256);
    var iFACTOR = Math.log(256) / Math.log(BASE);
    function encode14(source) {
      if (source instanceof Uint8Array)
        ;
      else if (ArrayBuffer.isView(source)) {
        source = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      } else if (Array.isArray(source)) {
        source = Uint8Array.from(source);
      }
      if (!(source instanceof Uint8Array)) {
        throw new TypeError("Expected Uint8Array");
      }
      if (source.length === 0) {
        return "";
      }
      var zeroes = 0;
      var length4 = 0;
      var pbegin = 0;
      var pend = source.length;
      while (pbegin !== pend && source[pbegin] === 0) {
        pbegin++;
        zeroes++;
      }
      var size = (pend - pbegin) * iFACTOR + 1 >>> 0;
      var b58 = new Uint8Array(size);
      while (pbegin !== pend) {
        var carry = source[pbegin];
        var i2 = 0;
        for (var it1 = size - 1; (carry !== 0 || i2 < length4) && it1 !== -1; it1--, i2++) {
          carry += 256 * b58[it1] >>> 0;
          b58[it1] = carry % BASE >>> 0;
          carry = carry / BASE >>> 0;
        }
        if (carry !== 0) {
          throw new Error("Non-zero carry");
        }
        length4 = i2;
        pbegin++;
      }
      var it2 = size - length4;
      while (it2 !== size && b58[it2] === 0) {
        it2++;
      }
      var str = LEADER.repeat(zeroes);
      for (; it2 < size; ++it2) {
        str += ALPHABET.charAt(b58[it2]);
      }
      return str;
    }
    function decodeUnsafe(source) {
      if (typeof source !== "string") {
        throw new TypeError("Expected String");
      }
      if (source.length === 0) {
        return new Uint8Array();
      }
      var psz = 0;
      if (source[psz] === " ") {
        return;
      }
      var zeroes = 0;
      var length4 = 0;
      while (source[psz] === LEADER) {
        zeroes++;
        psz++;
      }
      var size = (source.length - psz) * FACTOR + 1 >>> 0;
      var b256 = new Uint8Array(size);
      while (source[psz]) {
        var carry = BASE_MAP[source.charCodeAt(psz)];
        if (carry === 255) {
          return;
        }
        var i2 = 0;
        for (var it3 = size - 1; (carry !== 0 || i2 < length4) && it3 !== -1; it3--, i2++) {
          carry += BASE * b256[it3] >>> 0;
          b256[it3] = carry % 256 >>> 0;
          carry = carry / 256 >>> 0;
        }
        if (carry !== 0) {
          throw new Error("Non-zero carry");
        }
        length4 = i2;
        psz++;
      }
      if (source[psz] === " ") {
        return;
      }
      var it4 = size - length4;
      while (it4 !== size && b256[it4] === 0) {
        it4++;
      }
      var vch = new Uint8Array(zeroes + (size - it4));
      var j2 = zeroes;
      while (it4 !== size) {
        vch[j2++] = b256[it4++];
      }
      return vch;
    }
    function decode15(string4) {
      var buffer2 = decodeUnsafe(string4);
      if (buffer2) {
        return buffer2;
      }
      throw new Error(`Non-${name4} character`);
    }
    return {
      encode: encode14,
      decodeUnsafe,
      decode: decode15
    };
  }
  var src = base;
  var _brrp__multiformats_scope_baseX = src;
  var base_x_default = _brrp__multiformats_scope_baseX;

  // node_modules/multiformats/esm/src/bytes.js
  var empty = new Uint8Array(0);
  var equals = (aa, bb) => {
    if (aa === bb)
      return true;
    if (aa.byteLength !== bb.byteLength) {
      return false;
    }
    for (let ii = 0; ii < aa.byteLength; ii++) {
      if (aa[ii] !== bb[ii]) {
        return false;
      }
    }
    return true;
  };
  var coerce = (o) => {
    if (o instanceof Uint8Array && o.constructor.name === "Uint8Array")
      return o;
    if (o instanceof ArrayBuffer)
      return new Uint8Array(o);
    if (ArrayBuffer.isView(o)) {
      return new Uint8Array(o.buffer, o.byteOffset, o.byteLength);
    }
    throw new Error("Unknown type, must be binary type");
  };
  var fromString = (str) => new TextEncoder().encode(str);
  var toString = (b) => new TextDecoder().decode(b);

  // node_modules/multiformats/esm/src/bases/base.js
  var Encoder = class {
    constructor(name4, prefix, baseEncode) {
      this.name = name4;
      this.prefix = prefix;
      this.baseEncode = baseEncode;
    }
    encode(bytes2) {
      if (bytes2 instanceof Uint8Array) {
        return `${this.prefix}${this.baseEncode(bytes2)}`;
      } else {
        throw Error("Unknown type, must be binary type");
      }
    }
  };
  var Decoder = class {
    constructor(name4, prefix, baseDecode) {
      this.name = name4;
      this.prefix = prefix;
      if (prefix.codePointAt(0) === void 0) {
        throw new Error("Invalid prefix character");
      }
      this.prefixCodePoint = prefix.codePointAt(0);
      this.baseDecode = baseDecode;
    }
    decode(text) {
      if (typeof text === "string") {
        if (text.codePointAt(0) !== this.prefixCodePoint) {
          throw Error(`Unable to decode multibase string ${JSON.stringify(text)}, ${this.name} decoder only supports inputs prefixed with ${this.prefix}`);
        }
        return this.baseDecode(text.slice(this.prefix.length));
      } else {
        throw Error("Can only multibase decode strings");
      }
    }
    or(decoder) {
      return or(this, decoder);
    }
  };
  var ComposedDecoder = class {
    constructor(decoders) {
      this.decoders = decoders;
    }
    or(decoder) {
      return or(this, decoder);
    }
    decode(input) {
      const prefix = input[0];
      const decoder = this.decoders[prefix];
      if (decoder) {
        return decoder.decode(input);
      } else {
        throw RangeError(`Unable to decode multibase string ${JSON.stringify(input)}, only inputs prefixed with ${Object.keys(this.decoders)} are supported`);
      }
    }
  };
  var or = (left, right) => new ComposedDecoder({
    ...left.decoders || { [left.prefix]: left },
    ...right.decoders || { [right.prefix]: right }
  });
  var Codec = class {
    constructor(name4, prefix, baseEncode, baseDecode) {
      this.name = name4;
      this.prefix = prefix;
      this.baseEncode = baseEncode;
      this.baseDecode = baseDecode;
      this.encoder = new Encoder(name4, prefix, baseEncode);
      this.decoder = new Decoder(name4, prefix, baseDecode);
    }
    encode(input) {
      return this.encoder.encode(input);
    }
    decode(input) {
      return this.decoder.decode(input);
    }
  };
  var from = ({ name: name4, prefix, encode: encode14, decode: decode15 }) => new Codec(name4, prefix, encode14, decode15);
  var baseX = ({ prefix, name: name4, alphabet: alphabet3 }) => {
    const { encode: encode14, decode: decode15 } = base_x_default(alphabet3, name4);
    return from({
      prefix,
      name: name4,
      encode: encode14,
      decode: (text) => coerce(decode15(text))
    });
  };
  var decode = (string4, alphabet3, bitsPerChar, name4) => {
    const codes = {};
    for (let i = 0; i < alphabet3.length; ++i) {
      codes[alphabet3[i]] = i;
    }
    let end = string4.length;
    while (string4[end - 1] === "=") {
      --end;
    }
    const out = new Uint8Array(end * bitsPerChar / 8 | 0);
    let bits = 0;
    let buffer2 = 0;
    let written = 0;
    for (let i = 0; i < end; ++i) {
      const value = codes[string4[i]];
      if (value === void 0) {
        throw new SyntaxError(`Non-${name4} character`);
      }
      buffer2 = buffer2 << bitsPerChar | value;
      bits += bitsPerChar;
      if (bits >= 8) {
        bits -= 8;
        out[written++] = 255 & buffer2 >> bits;
      }
    }
    if (bits >= bitsPerChar || 255 & buffer2 << 8 - bits) {
      throw new SyntaxError("Unexpected end of data");
    }
    return out;
  };
  var encode = (data, alphabet3, bitsPerChar) => {
    const pad = alphabet3[alphabet3.length - 1] === "=";
    const mask = (1 << bitsPerChar) - 1;
    let out = "";
    let bits = 0;
    let buffer2 = 0;
    for (let i = 0; i < data.length; ++i) {
      buffer2 = buffer2 << 8 | data[i];
      bits += 8;
      while (bits > bitsPerChar) {
        bits -= bitsPerChar;
        out += alphabet3[mask & buffer2 >> bits];
      }
    }
    if (bits) {
      out += alphabet3[mask & buffer2 << bitsPerChar - bits];
    }
    if (pad) {
      while (out.length * bitsPerChar & 7) {
        out += "=";
      }
    }
    return out;
  };
  var rfc4648 = ({ name: name4, prefix, bitsPerChar, alphabet: alphabet3 }) => {
    return from({
      prefix,
      name: name4,
      encode(input) {
        return encode(input, alphabet3, bitsPerChar);
      },
      decode(input) {
        return decode(input, alphabet3, bitsPerChar, name4);
      }
    });
  };

  // node_modules/multiformats/esm/src/bases/identity.js
  var identity = from({
    prefix: "\0",
    name: "identity",
    encode: (buf2) => toString(buf2),
    decode: (str) => fromString(str)
  });

  // node_modules/multiformats/esm/src/bases/base2.js
  var base2_exports = {};
  __export(base2_exports, {
    base2: () => base2
  });
  var base2 = rfc4648({
    prefix: "0",
    name: "base2",
    alphabet: "01",
    bitsPerChar: 1
  });

  // node_modules/multiformats/esm/src/bases/base8.js
  var base8_exports = {};
  __export(base8_exports, {
    base8: () => base8
  });
  var base8 = rfc4648({
    prefix: "7",
    name: "base8",
    alphabet: "01234567",
    bitsPerChar: 3
  });

  // node_modules/multiformats/esm/src/bases/base10.js
  var base10_exports = {};
  __export(base10_exports, {
    base10: () => base10
  });
  var base10 = baseX({
    prefix: "9",
    name: "base10",
    alphabet: "0123456789"
  });

  // node_modules/multiformats/esm/src/bases/base16.js
  var base16_exports = {};
  __export(base16_exports, {
    base16: () => base16,
    base16upper: () => base16upper
  });
  var base16 = rfc4648({
    prefix: "f",
    name: "base16",
    alphabet: "0123456789abcdef",
    bitsPerChar: 4
  });
  var base16upper = rfc4648({
    prefix: "F",
    name: "base16upper",
    alphabet: "0123456789ABCDEF",
    bitsPerChar: 4
  });

  // node_modules/multiformats/esm/src/bases/base32.js
  var base32_exports = {};
  __export(base32_exports, {
    base32: () => base32,
    base32hex: () => base32hex,
    base32hexpad: () => base32hexpad,
    base32hexpadupper: () => base32hexpadupper,
    base32hexupper: () => base32hexupper,
    base32pad: () => base32pad,
    base32padupper: () => base32padupper,
    base32upper: () => base32upper,
    base32z: () => base32z
  });
  var base32 = rfc4648({
    prefix: "b",
    name: "base32",
    alphabet: "abcdefghijklmnopqrstuvwxyz234567",
    bitsPerChar: 5
  });
  var base32upper = rfc4648({
    prefix: "B",
    name: "base32upper",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    bitsPerChar: 5
  });
  var base32pad = rfc4648({
    prefix: "c",
    name: "base32pad",
    alphabet: "abcdefghijklmnopqrstuvwxyz234567=",
    bitsPerChar: 5
  });
  var base32padupper = rfc4648({
    prefix: "C",
    name: "base32padupper",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567=",
    bitsPerChar: 5
  });
  var base32hex = rfc4648({
    prefix: "v",
    name: "base32hex",
    alphabet: "0123456789abcdefghijklmnopqrstuv",
    bitsPerChar: 5
  });
  var base32hexupper = rfc4648({
    prefix: "V",
    name: "base32hexupper",
    alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUV",
    bitsPerChar: 5
  });
  var base32hexpad = rfc4648({
    prefix: "t",
    name: "base32hexpad",
    alphabet: "0123456789abcdefghijklmnopqrstuv=",
    bitsPerChar: 5
  });
  var base32hexpadupper = rfc4648({
    prefix: "T",
    name: "base32hexpadupper",
    alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUV=",
    bitsPerChar: 5
  });
  var base32z = rfc4648({
    prefix: "h",
    name: "base32z",
    alphabet: "ybndrfg8ejkmcpqxot1uwisza345h769",
    bitsPerChar: 5
  });

  // node_modules/multiformats/esm/src/bases/base36.js
  var base36_exports = {};
  __export(base36_exports, {
    base36: () => base36,
    base36upper: () => base36upper
  });
  var base36 = baseX({
    prefix: "k",
    name: "base36",
    alphabet: "0123456789abcdefghijklmnopqrstuvwxyz"
  });
  var base36upper = baseX({
    prefix: "K",
    name: "base36upper",
    alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  });

  // node_modules/multiformats/esm/src/bases/base58.js
  var base58_exports = {};
  __export(base58_exports, {
    base58btc: () => base58btc,
    base58flickr: () => base58flickr
  });
  var base58btc = baseX({
    name: "base58btc",
    prefix: "z",
    alphabet: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
  });
  var base58flickr = baseX({
    name: "base58flickr",
    prefix: "Z",
    alphabet: "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
  });

  // node_modules/multiformats/esm/src/bases/base64.js
  var base64_exports = {};
  __export(base64_exports, {
    base64: () => base64,
    base64pad: () => base64pad,
    base64url: () => base64url,
    base64urlpad: () => base64urlpad
  });
  var base64 = rfc4648({
    prefix: "m",
    name: "base64",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    bitsPerChar: 6
  });
  var base64pad = rfc4648({
    prefix: "M",
    name: "base64pad",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    bitsPerChar: 6
  });
  var base64url = rfc4648({
    prefix: "u",
    name: "base64url",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
    bitsPerChar: 6
  });
  var base64urlpad = rfc4648({
    prefix: "U",
    name: "base64urlpad",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=",
    bitsPerChar: 6
  });

  // node_modules/multiformats/esm/src/bases/base256emoji.js
  var base256emoji_exports = {};
  __export(base256emoji_exports, {
    base256emoji: () => base256emoji
  });
  var alphabet = Array.from("\u{1F680}\u{1FA90}\u2604\u{1F6F0}\u{1F30C}\u{1F311}\u{1F312}\u{1F313}\u{1F314}\u{1F315}\u{1F316}\u{1F317}\u{1F318}\u{1F30D}\u{1F30F}\u{1F30E}\u{1F409}\u2600\u{1F4BB}\u{1F5A5}\u{1F4BE}\u{1F4BF}\u{1F602}\u2764\u{1F60D}\u{1F923}\u{1F60A}\u{1F64F}\u{1F495}\u{1F62D}\u{1F618}\u{1F44D}\u{1F605}\u{1F44F}\u{1F601}\u{1F525}\u{1F970}\u{1F494}\u{1F496}\u{1F499}\u{1F622}\u{1F914}\u{1F606}\u{1F644}\u{1F4AA}\u{1F609}\u263A\u{1F44C}\u{1F917}\u{1F49C}\u{1F614}\u{1F60E}\u{1F607}\u{1F339}\u{1F926}\u{1F389}\u{1F49E}\u270C\u2728\u{1F937}\u{1F631}\u{1F60C}\u{1F338}\u{1F64C}\u{1F60B}\u{1F497}\u{1F49A}\u{1F60F}\u{1F49B}\u{1F642}\u{1F493}\u{1F929}\u{1F604}\u{1F600}\u{1F5A4}\u{1F603}\u{1F4AF}\u{1F648}\u{1F447}\u{1F3B6}\u{1F612}\u{1F92D}\u2763\u{1F61C}\u{1F48B}\u{1F440}\u{1F62A}\u{1F611}\u{1F4A5}\u{1F64B}\u{1F61E}\u{1F629}\u{1F621}\u{1F92A}\u{1F44A}\u{1F973}\u{1F625}\u{1F924}\u{1F449}\u{1F483}\u{1F633}\u270B\u{1F61A}\u{1F61D}\u{1F634}\u{1F31F}\u{1F62C}\u{1F643}\u{1F340}\u{1F337}\u{1F63B}\u{1F613}\u2B50\u2705\u{1F97A}\u{1F308}\u{1F608}\u{1F918}\u{1F4A6}\u2714\u{1F623}\u{1F3C3}\u{1F490}\u2639\u{1F38A}\u{1F498}\u{1F620}\u261D\u{1F615}\u{1F33A}\u{1F382}\u{1F33B}\u{1F610}\u{1F595}\u{1F49D}\u{1F64A}\u{1F639}\u{1F5E3}\u{1F4AB}\u{1F480}\u{1F451}\u{1F3B5}\u{1F91E}\u{1F61B}\u{1F534}\u{1F624}\u{1F33C}\u{1F62B}\u26BD\u{1F919}\u2615\u{1F3C6}\u{1F92B}\u{1F448}\u{1F62E}\u{1F646}\u{1F37B}\u{1F343}\u{1F436}\u{1F481}\u{1F632}\u{1F33F}\u{1F9E1}\u{1F381}\u26A1\u{1F31E}\u{1F388}\u274C\u270A\u{1F44B}\u{1F630}\u{1F928}\u{1F636}\u{1F91D}\u{1F6B6}\u{1F4B0}\u{1F353}\u{1F4A2}\u{1F91F}\u{1F641}\u{1F6A8}\u{1F4A8}\u{1F92C}\u2708\u{1F380}\u{1F37A}\u{1F913}\u{1F619}\u{1F49F}\u{1F331}\u{1F616}\u{1F476}\u{1F974}\u25B6\u27A1\u2753\u{1F48E}\u{1F4B8}\u2B07\u{1F628}\u{1F31A}\u{1F98B}\u{1F637}\u{1F57A}\u26A0\u{1F645}\u{1F61F}\u{1F635}\u{1F44E}\u{1F932}\u{1F920}\u{1F927}\u{1F4CC}\u{1F535}\u{1F485}\u{1F9D0}\u{1F43E}\u{1F352}\u{1F617}\u{1F911}\u{1F30A}\u{1F92F}\u{1F437}\u260E\u{1F4A7}\u{1F62F}\u{1F486}\u{1F446}\u{1F3A4}\u{1F647}\u{1F351}\u2744\u{1F334}\u{1F4A3}\u{1F438}\u{1F48C}\u{1F4CD}\u{1F940}\u{1F922}\u{1F445}\u{1F4A1}\u{1F4A9}\u{1F450}\u{1F4F8}\u{1F47B}\u{1F910}\u{1F92E}\u{1F3BC}\u{1F975}\u{1F6A9}\u{1F34E}\u{1F34A}\u{1F47C}\u{1F48D}\u{1F4E3}\u{1F942}");
  var alphabetBytesToChars = alphabet.reduce((p, c, i) => {
    p[i] = c;
    return p;
  }, []);
  var alphabetCharsToBytes = alphabet.reduce((p, c, i) => {
    p[c.codePointAt(0)] = i;
    return p;
  }, []);
  function encode2(data) {
    return data.reduce((p, c) => {
      p += alphabetBytesToChars[c];
      return p;
    }, "");
  }
  function decode2(str) {
    const byts = [];
    for (const char of str) {
      const byt = alphabetCharsToBytes[char.codePointAt(0)];
      if (byt === void 0) {
        throw new Error(`Non-base256emoji character: ${char}`);
      }
      byts.push(byt);
    }
    return new Uint8Array(byts);
  }
  var base256emoji = from({
    prefix: "\u{1F680}",
    name: "base256emoji",
    encode: encode2,
    decode: decode2
  });

  // node_modules/multiformats/esm/src/hashes/sha2-browser.js
  var sha2_browser_exports = {};
  __export(sha2_browser_exports, {
    sha256: () => sha256,
    sha512: () => sha512
  });

  // node_modules/multiformats/esm/vendor/varint.js
  var encode_1 = encode3;
  var MSB = 128;
  var REST = 127;
  var MSBALL = ~REST;
  var INT = Math.pow(2, 31);
  function encode3(num, out, offset) {
    out = out || [];
    offset = offset || 0;
    var oldOffset = offset;
    while (num >= INT) {
      out[offset++] = num & 255 | MSB;
      num /= 128;
    }
    while (num & MSBALL) {
      out[offset++] = num & 255 | MSB;
      num >>>= 7;
    }
    out[offset] = num | 0;
    encode3.bytes = offset - oldOffset + 1;
    return out;
  }
  var decode3 = read;
  var MSB$1 = 128;
  var REST$1 = 127;
  function read(buf2, offset) {
    var res = 0, offset = offset || 0, shift = 0, counter = offset, b, l = buf2.length;
    do {
      if (counter >= l) {
        read.bytes = 0;
        throw new RangeError("Could not decode varint");
      }
      b = buf2[counter++];
      res += shift < 28 ? (b & REST$1) << shift : (b & REST$1) * Math.pow(2, shift);
      shift += 7;
    } while (b >= MSB$1);
    read.bytes = counter - offset;
    return res;
  }
  var N1 = Math.pow(2, 7);
  var N2 = Math.pow(2, 14);
  var N3 = Math.pow(2, 21);
  var N4 = Math.pow(2, 28);
  var N5 = Math.pow(2, 35);
  var N6 = Math.pow(2, 42);
  var N7 = Math.pow(2, 49);
  var N8 = Math.pow(2, 56);
  var N9 = Math.pow(2, 63);
  var length = function(value) {
    return value < N1 ? 1 : value < N2 ? 2 : value < N3 ? 3 : value < N4 ? 4 : value < N5 ? 5 : value < N6 ? 6 : value < N7 ? 7 : value < N8 ? 8 : value < N9 ? 9 : 10;
  };
  var varint = {
    encode: encode_1,
    decode: decode3,
    encodingLength: length
  };
  var _brrp_varint = varint;
  var varint_default = _brrp_varint;

  // node_modules/multiformats/esm/src/varint.js
  var decode4 = (data, offset = 0) => {
    const code4 = varint_default.decode(data, offset);
    return [
      code4,
      varint_default.decode.bytes
    ];
  };
  var encodeTo = (int, target, offset = 0) => {
    varint_default.encode(int, target, offset);
    return target;
  };
  var encodingLength = (int) => {
    return varint_default.encodingLength(int);
  };

  // node_modules/multiformats/esm/src/hashes/digest.js
  var create = (code4, digest3) => {
    const size = digest3.byteLength;
    const sizeOffset = encodingLength(code4);
    const digestOffset = sizeOffset + encodingLength(size);
    const bytes2 = new Uint8Array(digestOffset + size);
    encodeTo(code4, bytes2, 0);
    encodeTo(size, bytes2, sizeOffset);
    bytes2.set(digest3, digestOffset);
    return new Digest(code4, size, digest3, bytes2);
  };
  var decode5 = (multihash) => {
    const bytes2 = coerce(multihash);
    const [code4, sizeOffset] = decode4(bytes2);
    const [size, digestOffset] = decode4(bytes2.subarray(sizeOffset));
    const digest3 = bytes2.subarray(sizeOffset + digestOffset);
    if (digest3.byteLength !== size) {
      throw new Error("Incorrect length");
    }
    return new Digest(code4, size, digest3, bytes2);
  };
  var equals2 = (a, b) => {
    if (a === b) {
      return true;
    } else {
      return a.code === b.code && a.size === b.size && equals(a.bytes, b.bytes);
    }
  };
  var Digest = class {
    constructor(code4, size, digest3, bytes2) {
      this.code = code4;
      this.size = size;
      this.digest = digest3;
      this.bytes = bytes2;
    }
  };

  // node_modules/multiformats/esm/src/hashes/hasher.js
  var from2 = ({ name: name4, code: code4, encode: encode14 }) => new Hasher(name4, code4, encode14);
  var Hasher = class {
    constructor(name4, code4, encode14) {
      this.name = name4;
      this.code = code4;
      this.encode = encode14;
    }
    digest(input) {
      if (input instanceof Uint8Array) {
        const result = this.encode(input);
        return result instanceof Uint8Array ? create(this.code, result) : result.then((digest3) => create(this.code, digest3));
      } else {
        throw Error("Unknown type, must be binary type");
      }
    }
  };

  // node_modules/multiformats/esm/src/hashes/sha2-browser.js
  var sha = (name4) => async (data) => new Uint8Array(await crypto.subtle.digest(name4, data));
  var sha256 = from2({
    name: "sha2-256",
    code: 18,
    encode: sha("SHA-256")
  });
  var sha512 = from2({
    name: "sha2-512",
    code: 19,
    encode: sha("SHA-512")
  });

  // node_modules/multiformats/esm/src/hashes/identity.js
  var identity_exports2 = {};
  __export(identity_exports2, {
    identity: () => identity2
  });
  var code = 0;
  var name = "identity";
  var encode4 = coerce;
  var digest = (input) => create(code, encode4(input));
  var identity2 = {
    code,
    name,
    encode: encode4,
    digest
  };

  // node_modules/multiformats/esm/src/codecs/json.js
  var textEncoder = new TextEncoder();
  var textDecoder = new TextDecoder();

  // node_modules/multiformats/esm/src/cid.js
  var CID = class {
    constructor(version2, code4, multihash, bytes2) {
      this.code = code4;
      this.version = version2;
      this.multihash = multihash;
      this.bytes = bytes2;
      this.byteOffset = bytes2.byteOffset;
      this.byteLength = bytes2.byteLength;
      this.asCID = this;
      this._baseCache = /* @__PURE__ */ new Map();
      Object.defineProperties(this, {
        byteOffset: hidden,
        byteLength: hidden,
        code: readonly,
        version: readonly,
        multihash: readonly,
        bytes: readonly,
        _baseCache: hidden,
        asCID: hidden
      });
    }
    toV0() {
      switch (this.version) {
        case 0: {
          return this;
        }
        default: {
          const { code: code4, multihash } = this;
          if (code4 !== DAG_PB_CODE) {
            throw new Error("Cannot convert a non dag-pb CID to CIDv0");
          }
          if (multihash.code !== SHA_256_CODE) {
            throw new Error("Cannot convert non sha2-256 multihash CID to CIDv0");
          }
          return CID.createV0(multihash);
        }
      }
    }
    toV1() {
      switch (this.version) {
        case 0: {
          const { code: code4, digest: digest3 } = this.multihash;
          const multihash = create(code4, digest3);
          return CID.createV1(this.code, multihash);
        }
        case 1: {
          return this;
        }
        default: {
          throw Error(`Can not convert CID version ${this.version} to version 0. This is a bug please report`);
        }
      }
    }
    equals(other) {
      return other && this.code === other.code && this.version === other.version && equals2(this.multihash, other.multihash);
    }
    toString(base4) {
      const { bytes: bytes2, version: version2, _baseCache } = this;
      switch (version2) {
        case 0:
          return toStringV0(bytes2, _baseCache, base4 || base58btc.encoder);
        default:
          return toStringV1(bytes2, _baseCache, base4 || base32.encoder);
      }
    }
    toJSON() {
      return {
        code: this.code,
        version: this.version,
        hash: this.multihash.bytes
      };
    }
    get [Symbol.toStringTag]() {
      return "CID";
    }
    [Symbol.for("nodejs.util.inspect.custom")]() {
      return "CID(" + this.toString() + ")";
    }
    static isCID(value) {
      deprecate(/^0\.0/, IS_CID_DEPRECATION);
      return !!(value && (value[cidSymbol] || value.asCID === value));
    }
    get toBaseEncodedString() {
      throw new Error("Deprecated, use .toString()");
    }
    get codec() {
      throw new Error('"codec" property is deprecated, use integer "code" property instead');
    }
    get buffer() {
      throw new Error("Deprecated .buffer property, use .bytes to get Uint8Array instead");
    }
    get multibaseName() {
      throw new Error('"multibaseName" property is deprecated');
    }
    get prefix() {
      throw new Error('"prefix" property is deprecated');
    }
    static asCID(value) {
      if (value instanceof CID) {
        return value;
      } else if (value != null && value.asCID === value) {
        const { version: version2, code: code4, multihash, bytes: bytes2 } = value;
        return new CID(version2, code4, multihash, bytes2 || encodeCID(version2, code4, multihash.bytes));
      } else if (value != null && value[cidSymbol] === true) {
        const { version: version2, multihash, code: code4 } = value;
        const digest3 = decode5(multihash);
        return CID.create(version2, code4, digest3);
      } else {
        return null;
      }
    }
    static create(version2, code4, digest3) {
      if (typeof code4 !== "number") {
        throw new Error("String codecs are no longer supported");
      }
      switch (version2) {
        case 0: {
          if (code4 !== DAG_PB_CODE) {
            throw new Error(`Version 0 CID must use dag-pb (code: ${DAG_PB_CODE}) block encoding`);
          } else {
            return new CID(version2, code4, digest3, digest3.bytes);
          }
        }
        case 1: {
          const bytes2 = encodeCID(version2, code4, digest3.bytes);
          return new CID(version2, code4, digest3, bytes2);
        }
        default: {
          throw new Error("Invalid version");
        }
      }
    }
    static createV0(digest3) {
      return CID.create(0, DAG_PB_CODE, digest3);
    }
    static createV1(code4, digest3) {
      return CID.create(1, code4, digest3);
    }
    static decode(bytes2) {
      const [cid, remainder] = CID.decodeFirst(bytes2);
      if (remainder.length) {
        throw new Error("Incorrect length");
      }
      return cid;
    }
    static decodeFirst(bytes2) {
      const specs = CID.inspectBytes(bytes2);
      const prefixSize = specs.size - specs.multihashSize;
      const multihashBytes = coerce(bytes2.subarray(prefixSize, prefixSize + specs.multihashSize));
      if (multihashBytes.byteLength !== specs.multihashSize) {
        throw new Error("Incorrect length");
      }
      const digestBytes = multihashBytes.subarray(specs.multihashSize - specs.digestSize);
      const digest3 = new Digest(specs.multihashCode, specs.digestSize, digestBytes, multihashBytes);
      const cid = specs.version === 0 ? CID.createV0(digest3) : CID.createV1(specs.codec, digest3);
      return [
        cid,
        bytes2.subarray(specs.size)
      ];
    }
    static inspectBytes(initialBytes) {
      let offset = 0;
      const next = () => {
        const [i, length4] = decode4(initialBytes.subarray(offset));
        offset += length4;
        return i;
      };
      let version2 = next();
      let codec = DAG_PB_CODE;
      if (version2 === 18) {
        version2 = 0;
        offset = 0;
      } else if (version2 === 1) {
        codec = next();
      }
      if (version2 !== 0 && version2 !== 1) {
        throw new RangeError(`Invalid CID version ${version2}`);
      }
      const prefixSize = offset;
      const multihashCode = next();
      const digestSize = next();
      const size = offset + digestSize;
      const multihashSize = size - prefixSize;
      return {
        version: version2,
        codec,
        multihashCode,
        digestSize,
        multihashSize,
        size
      };
    }
    static parse(source, base4) {
      const [prefix, bytes2] = parseCIDtoBytes(source, base4);
      const cid = CID.decode(bytes2);
      cid._baseCache.set(prefix, source);
      return cid;
    }
  };
  var parseCIDtoBytes = (source, base4) => {
    switch (source[0]) {
      case "Q": {
        const decoder = base4 || base58btc;
        return [
          base58btc.prefix,
          decoder.decode(`${base58btc.prefix}${source}`)
        ];
      }
      case base58btc.prefix: {
        const decoder = base4 || base58btc;
        return [
          base58btc.prefix,
          decoder.decode(source)
        ];
      }
      case base32.prefix: {
        const decoder = base4 || base32;
        return [
          base32.prefix,
          decoder.decode(source)
        ];
      }
      default: {
        if (base4 == null) {
          throw Error("To parse non base32 or base58btc encoded CID multibase decoder must be provided");
        }
        return [
          source[0],
          base4.decode(source)
        ];
      }
    }
  };
  var toStringV0 = (bytes2, cache2, base4) => {
    const { prefix } = base4;
    if (prefix !== base58btc.prefix) {
      throw Error(`Cannot string encode V0 in ${base4.name} encoding`);
    }
    const cid = cache2.get(prefix);
    if (cid == null) {
      const cid2 = base4.encode(bytes2).slice(1);
      cache2.set(prefix, cid2);
      return cid2;
    } else {
      return cid;
    }
  };
  var toStringV1 = (bytes2, cache2, base4) => {
    const { prefix } = base4;
    const cid = cache2.get(prefix);
    if (cid == null) {
      const cid2 = base4.encode(bytes2);
      cache2.set(prefix, cid2);
      return cid2;
    } else {
      return cid;
    }
  };
  var DAG_PB_CODE = 112;
  var SHA_256_CODE = 18;
  var encodeCID = (version2, code4, multihash) => {
    const codeOffset = encodingLength(version2);
    const hashOffset = codeOffset + encodingLength(code4);
    const bytes2 = new Uint8Array(hashOffset + multihash.byteLength);
    encodeTo(version2, bytes2, 0);
    encodeTo(code4, bytes2, codeOffset);
    bytes2.set(multihash, hashOffset);
    return bytes2;
  };
  var cidSymbol = Symbol.for("@ipld/js-cid/CID");
  var readonly = {
    writable: false,
    configurable: false,
    enumerable: true
  };
  var hidden = {
    writable: false,
    enumerable: false,
    configurable: false
  };
  var version = "0.0.0-dev";
  var deprecate = (range, message) => {
    if (range.test(version)) {
      console.warn(message);
    } else {
      throw new Error(message);
    }
  };
  var IS_CID_DEPRECATION = `CID.isCID(v) is deprecated and will be removed in the next major release.
Following code pattern:

if (CID.isCID(value)) {
  doSomethingWithCID(value)
}

Is replaced with:

const cid = CID.asCID(value)
if (cid) {
  // Make sure to use cid instead of value
  doSomethingWithCID(cid)
}
`;

  // node_modules/multiformats/esm/src/basics.js
  var bases = {
    ...identity_exports,
    ...base2_exports,
    ...base8_exports,
    ...base10_exports,
    ...base16_exports,
    ...base32_exports,
    ...base36_exports,
    ...base58_exports,
    ...base64_exports,
    ...base256emoji_exports
  };
  var hashes = {
    ...sha2_browser_exports,
    ...identity_exports2
  };

  // node_modules/uint8arrays/esm/src/util/bases.js
  function createCodec(name4, prefix, encode14, decode15) {
    return {
      name: name4,
      prefix,
      encoder: {
        name: name4,
        prefix,
        encode: encode14
      },
      decoder: { decode: decode15 }
    };
  }
  var string = createCodec("utf8", "u", (buf2) => {
    const decoder = new TextDecoder("utf8");
    return "u" + decoder.decode(buf2);
  }, (str) => {
    const encoder = new TextEncoder();
    return encoder.encode(str.substring(1));
  });
  var ascii = createCodec("ascii", "a", (buf2) => {
    let string4 = "a";
    for (let i = 0; i < buf2.length; i++) {
      string4 += String.fromCharCode(buf2[i]);
    }
    return string4;
  }, (str) => {
    str = str.substring(1);
    const buf2 = allocUnsafe(str.length);
    for (let i = 0; i < str.length; i++) {
      buf2[i] = str.charCodeAt(i);
    }
    return buf2;
  });
  var BASES = {
    utf8: string,
    "utf-8": string,
    hex: bases.base16,
    latin1: ascii,
    ascii,
    binary: ascii,
    ...bases
  };
  var bases_default = BASES;

  // node_modules/uint8arrays/esm/src/from-string.js
  function fromString2(string4, encoding = "utf8") {
    const base4 = bases_default[encoding];
    if (!base4) {
      throw new Error(`Unsupported encoding "${encoding}"`);
    }
    if ((encoding === "utf8" || encoding === "utf-8") && globalThis.Buffer != null && globalThis.Buffer.from != null) {
      return asUint8Array(globalThis.Buffer.from(string4, "utf-8"));
    }
    return base4.decoder.decode(`${base4.prefix}${string4}`);
  }

  // node_modules/uint8arrays/esm/src/to-string.js
  function toString2(array2, encoding = "utf8") {
    const base4 = bases_default[encoding];
    if (!base4) {
      throw new Error(`Unsupported encoding "${encoding}"`);
    }
    if ((encoding === "utf8" || encoding === "utf-8") && globalThis.Buffer != null && globalThis.Buffer.from != null) {
      return globalThis.Buffer.from(array2.buffer, array2.byteOffset, array2.byteLength).toString("utf8");
    }
    return base4.encoder.encode(array2).substring(1);
  }

  // lit_actions/src/utils.ts
  var import_fast_json_stable_stringify = __toESM(require_fast_json_stable_stringify());
  var import_elliptic = __toESM(require_elliptic());
  var import_sha2562 = __toESM(require_sha256());

  // node_modules/@ipld/dag-cbor/esm/index.js
  var esm_exports = {};
  __export(esm_exports, {
    code: () => code2,
    decode: () => decode7,
    encode: () => encode6,
    name: () => name2
  });

  // node_modules/cborg/esm/lib/is.js
  var typeofs = [
    "string",
    "number",
    "bigint",
    "symbol"
  ];
  var objectTypeNames = [
    "Function",
    "Generator",
    "AsyncGenerator",
    "GeneratorFunction",
    "AsyncGeneratorFunction",
    "AsyncFunction",
    "Observable",
    "Array",
    "Buffer",
    "Object",
    "RegExp",
    "Date",
    "Error",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "ArrayBuffer",
    "SharedArrayBuffer",
    "DataView",
    "Promise",
    "URL",
    "HTMLElement",
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array"
  ];
  function is(value) {
    if (value === null) {
      return "null";
    }
    if (value === void 0) {
      return "undefined";
    }
    if (value === true || value === false) {
      return "boolean";
    }
    const typeOf = typeof value;
    if (typeofs.includes(typeOf)) {
      return typeOf;
    }
    if (typeOf === "function") {
      return "Function";
    }
    if (Array.isArray(value)) {
      return "Array";
    }
    if (isBuffer(value)) {
      return "Buffer";
    }
    const objectType = getObjectType(value);
    if (objectType) {
      return objectType;
    }
    return "Object";
  }
  function isBuffer(value) {
    return value && value.constructor && value.constructor.isBuffer && value.constructor.isBuffer.call(null, value);
  }
  function getObjectType(value) {
    const objectTypeName = Object.prototype.toString.call(value).slice(8, -1);
    if (objectTypeNames.includes(objectTypeName)) {
      return objectTypeName;
    }
    return void 0;
  }

  // node_modules/cborg/esm/lib/token.js
  var Type = class {
    constructor(major, name4, terminal) {
      this.major = major;
      this.majorEncoded = major << 5;
      this.name = name4;
      this.terminal = terminal;
    }
    toString() {
      return `Type[${this.major}].${this.name}`;
    }
    compare(typ) {
      return this.major < typ.major ? -1 : this.major > typ.major ? 1 : 0;
    }
  };
  Type.uint = new Type(0, "uint", true);
  Type.negint = new Type(1, "negint", true);
  Type.bytes = new Type(2, "bytes", true);
  Type.string = new Type(3, "string", true);
  Type.array = new Type(4, "array", false);
  Type.map = new Type(5, "map", false);
  Type.tag = new Type(6, "tag", false);
  Type.float = new Type(7, "float", true);
  Type.false = new Type(7, "false", true);
  Type.true = new Type(7, "true", true);
  Type.null = new Type(7, "null", true);
  Type.undefined = new Type(7, "undefined", true);
  Type.break = new Type(7, "break", true);
  var Token = class {
    constructor(type, value, encodedLength) {
      this.type = type;
      this.value = value;
      this.encodedLength = encodedLength;
      this.encodedBytes = void 0;
      this.byteValue = void 0;
    }
    toString() {
      return `Token[${this.type}].${this.value}`;
    }
  };

  // node_modules/cborg/esm/lib/byte-utils.js
  var useBuffer = globalThis.process && !globalThis.process.browser && globalThis.Buffer && typeof globalThis.Buffer.isBuffer === "function";
  var textDecoder2 = new TextDecoder();
  var textEncoder2 = new TextEncoder();
  function isBuffer2(buf2) {
    return useBuffer && globalThis.Buffer.isBuffer(buf2);
  }
  function asU8A(buf2) {
    if (!(buf2 instanceof Uint8Array)) {
      return Uint8Array.from(buf2);
    }
    return isBuffer2(buf2) ? new Uint8Array(buf2.buffer, buf2.byteOffset, buf2.byteLength) : buf2;
  }
  var toString3 = useBuffer ? (bytes2, start, end) => {
    return end - start > 64 ? globalThis.Buffer.from(bytes2.subarray(start, end)).toString("utf8") : utf8Slice(bytes2, start, end);
  } : (bytes2, start, end) => {
    return end - start > 64 ? textDecoder2.decode(bytes2.subarray(start, end)) : utf8Slice(bytes2, start, end);
  };
  var fromString3 = useBuffer ? (string4) => {
    return string4.length > 64 ? globalThis.Buffer.from(string4) : utf8ToBytes(string4);
  } : (string4) => {
    return string4.length > 64 ? textEncoder2.encode(string4) : utf8ToBytes(string4);
  };
  var fromArray = (arr) => {
    return Uint8Array.from(arr);
  };
  var slice = useBuffer ? (bytes2, start, end) => {
    if (isBuffer2(bytes2)) {
      return new Uint8Array(bytes2.subarray(start, end));
    }
    return bytes2.slice(start, end);
  } : (bytes2, start, end) => {
    return bytes2.slice(start, end);
  };
  var concat2 = useBuffer ? (chunks, length4) => {
    chunks = chunks.map((c) => c instanceof Uint8Array ? c : globalThis.Buffer.from(c));
    return asU8A(globalThis.Buffer.concat(chunks, length4));
  } : (chunks, length4) => {
    const out = new Uint8Array(length4);
    let off = 0;
    for (let b of chunks) {
      if (off + b.length > out.length) {
        b = b.subarray(0, out.length - off);
      }
      out.set(b, off);
      off += b.length;
    }
    return out;
  };
  var alloc = useBuffer ? (size) => {
    return globalThis.Buffer.allocUnsafe(size);
  } : (size) => {
    return new Uint8Array(size);
  };
  function compare2(b1, b2) {
    if (isBuffer2(b1) && isBuffer2(b2)) {
      return b1.compare(b2);
    }
    for (let i = 0; i < b1.length; i++) {
      if (b1[i] === b2[i]) {
        continue;
      }
      return b1[i] < b2[i] ? -1 : 1;
    }
    return 0;
  }
  function utf8ToBytes(string4, units = Infinity) {
    let codePoint;
    const length4 = string4.length;
    let leadSurrogate = null;
    const bytes2 = [];
    for (let i = 0; i < length4; ++i) {
      codePoint = string4.charCodeAt(i);
      if (codePoint > 55295 && codePoint < 57344) {
        if (!leadSurrogate) {
          if (codePoint > 56319) {
            if ((units -= 3) > -1)
              bytes2.push(239, 191, 189);
            continue;
          } else if (i + 1 === length4) {
            if ((units -= 3) > -1)
              bytes2.push(239, 191, 189);
            continue;
          }
          leadSurrogate = codePoint;
          continue;
        }
        if (codePoint < 56320) {
          if ((units -= 3) > -1)
            bytes2.push(239, 191, 189);
          leadSurrogate = codePoint;
          continue;
        }
        codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
      } else if (leadSurrogate) {
        if ((units -= 3) > -1)
          bytes2.push(239, 191, 189);
      }
      leadSurrogate = null;
      if (codePoint < 128) {
        if ((units -= 1) < 0)
          break;
        bytes2.push(codePoint);
      } else if (codePoint < 2048) {
        if ((units -= 2) < 0)
          break;
        bytes2.push(codePoint >> 6 | 192, codePoint & 63 | 128);
      } else if (codePoint < 65536) {
        if ((units -= 3) < 0)
          break;
        bytes2.push(codePoint >> 12 | 224, codePoint >> 6 & 63 | 128, codePoint & 63 | 128);
      } else if (codePoint < 1114112) {
        if ((units -= 4) < 0)
          break;
        bytes2.push(codePoint >> 18 | 240, codePoint >> 12 & 63 | 128, codePoint >> 6 & 63 | 128, codePoint & 63 | 128);
      } else {
        throw new Error("Invalid code point");
      }
    }
    return bytes2;
  }
  function utf8Slice(buf2, offset, end) {
    const res = [];
    while (offset < end) {
      const firstByte = buf2[offset];
      let codePoint = null;
      let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
      if (offset + bytesPerSequence <= end) {
        let secondByte, thirdByte, fourthByte, tempCodePoint;
        switch (bytesPerSequence) {
          case 1:
            if (firstByte < 128) {
              codePoint = firstByte;
            }
            break;
          case 2:
            secondByte = buf2[offset + 1];
            if ((secondByte & 192) === 128) {
              tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
              if (tempCodePoint > 127) {
                codePoint = tempCodePoint;
              }
            }
            break;
          case 3:
            secondByte = buf2[offset + 1];
            thirdByte = buf2[offset + 2];
            if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
              tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
              if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                codePoint = tempCodePoint;
              }
            }
            break;
          case 4:
            secondByte = buf2[offset + 1];
            thirdByte = buf2[offset + 2];
            fourthByte = buf2[offset + 3];
            if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
              tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
              if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                codePoint = tempCodePoint;
              }
            }
        }
      }
      if (codePoint === null) {
        codePoint = 65533;
        bytesPerSequence = 1;
      } else if (codePoint > 65535) {
        codePoint -= 65536;
        res.push(codePoint >>> 10 & 1023 | 55296);
        codePoint = 56320 | codePoint & 1023;
      }
      res.push(codePoint);
      offset += bytesPerSequence;
    }
    return decodeCodePointsArray(res);
  }
  var MAX_ARGUMENTS_LENGTH = 4096;
  function decodeCodePointsArray(codePoints) {
    const len = codePoints.length;
    if (len <= MAX_ARGUMENTS_LENGTH) {
      return String.fromCharCode.apply(String, codePoints);
    }
    let res = "";
    let i = 0;
    while (i < len) {
      res += String.fromCharCode.apply(String, codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH));
    }
    return res;
  }

  // node_modules/cborg/esm/lib/bl.js
  var defaultChunkSize = 256;
  var Bl = class {
    constructor(chunkSize = defaultChunkSize) {
      this.chunkSize = chunkSize;
      this.cursor = 0;
      this.maxCursor = -1;
      this.chunks = [];
      this._initReuseChunk = null;
    }
    reset() {
      this.cursor = 0;
      this.maxCursor = -1;
      if (this.chunks.length) {
        this.chunks = [];
      }
      if (this._initReuseChunk !== null) {
        this.chunks.push(this._initReuseChunk);
        this.maxCursor = this._initReuseChunk.length - 1;
      }
    }
    push(bytes2) {
      let topChunk = this.chunks[this.chunks.length - 1];
      const newMax = this.cursor + bytes2.length;
      if (newMax <= this.maxCursor + 1) {
        const chunkPos = topChunk.length - (this.maxCursor - this.cursor) - 1;
        topChunk.set(bytes2, chunkPos);
      } else {
        if (topChunk) {
          const chunkPos = topChunk.length - (this.maxCursor - this.cursor) - 1;
          if (chunkPos < topChunk.length) {
            this.chunks[this.chunks.length - 1] = topChunk.subarray(0, chunkPos);
            this.maxCursor = this.cursor - 1;
          }
        }
        if (bytes2.length < 64 && bytes2.length < this.chunkSize) {
          topChunk = alloc(this.chunkSize);
          this.chunks.push(topChunk);
          this.maxCursor += topChunk.length;
          if (this._initReuseChunk === null) {
            this._initReuseChunk = topChunk;
          }
          topChunk.set(bytes2, 0);
        } else {
          this.chunks.push(bytes2);
          this.maxCursor += bytes2.length;
        }
      }
      this.cursor += bytes2.length;
    }
    toBytes(reset = false) {
      let byts;
      if (this.chunks.length === 1) {
        const chunk = this.chunks[0];
        if (reset && this.cursor > chunk.length / 2) {
          byts = this.cursor === chunk.length ? chunk : chunk.subarray(0, this.cursor);
          this._initReuseChunk = null;
          this.chunks = [];
        } else {
          byts = slice(chunk, 0, this.cursor);
        }
      } else {
        byts = concat2(this.chunks, this.cursor);
      }
      if (reset) {
        this.reset();
      }
      return byts;
    }
  };

  // node_modules/cborg/esm/lib/common.js
  var decodeErrPrefix = "CBOR decode error:";
  var encodeErrPrefix = "CBOR encode error:";
  var uintMinorPrefixBytes = [];
  uintMinorPrefixBytes[23] = 1;
  uintMinorPrefixBytes[24] = 2;
  uintMinorPrefixBytes[25] = 3;
  uintMinorPrefixBytes[26] = 5;
  uintMinorPrefixBytes[27] = 9;
  function assertEnoughData(data, pos, need) {
    if (data.length - pos < need) {
      throw new Error(`${decodeErrPrefix} not enough data for type`);
    }
  }

  // node_modules/cborg/esm/lib/0uint.js
  var uintBoundaries = [
    24,
    256,
    65536,
    4294967296,
    BigInt("18446744073709551616")
  ];
  function readUint8(data, offset, options) {
    assertEnoughData(data, offset, 1);
    const value = data[offset];
    if (options.strict === true && value < uintBoundaries[0]) {
      throw new Error(`${decodeErrPrefix} integer encoded in more bytes than necessary (strict decode)`);
    }
    return value;
  }
  function readUint16(data, offset, options) {
    assertEnoughData(data, offset, 2);
    const value = data[offset] << 8 | data[offset + 1];
    if (options.strict === true && value < uintBoundaries[1]) {
      throw new Error(`${decodeErrPrefix} integer encoded in more bytes than necessary (strict decode)`);
    }
    return value;
  }
  function readUint32(data, offset, options) {
    assertEnoughData(data, offset, 4);
    const value = data[offset] * 16777216 + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3];
    if (options.strict === true && value < uintBoundaries[2]) {
      throw new Error(`${decodeErrPrefix} integer encoded in more bytes than necessary (strict decode)`);
    }
    return value;
  }
  function readUint64(data, offset, options) {
    assertEnoughData(data, offset, 8);
    const hi = data[offset] * 16777216 + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3];
    const lo = data[offset + 4] * 16777216 + (data[offset + 5] << 16) + (data[offset + 6] << 8) + data[offset + 7];
    const value = (BigInt(hi) << BigInt(32)) + BigInt(lo);
    if (options.strict === true && value < uintBoundaries[3]) {
      throw new Error(`${decodeErrPrefix} integer encoded in more bytes than necessary (strict decode)`);
    }
    if (value <= Number.MAX_SAFE_INTEGER) {
      return Number(value);
    }
    if (options.allowBigInt === true) {
      return value;
    }
    throw new Error(`${decodeErrPrefix} integers outside of the safe integer range are not supported`);
  }
  function decodeUint8(data, pos, _minor, options) {
    return new Token(Type.uint, readUint8(data, pos + 1, options), 2);
  }
  function decodeUint16(data, pos, _minor, options) {
    return new Token(Type.uint, readUint16(data, pos + 1, options), 3);
  }
  function decodeUint32(data, pos, _minor, options) {
    return new Token(Type.uint, readUint32(data, pos + 1, options), 5);
  }
  function decodeUint64(data, pos, _minor, options) {
    return new Token(Type.uint, readUint64(data, pos + 1, options), 9);
  }
  function encodeUint(buf2, token) {
    return encodeUintValue(buf2, 0, token.value);
  }
  function encodeUintValue(buf2, major, uint) {
    if (uint < uintBoundaries[0]) {
      const nuint = Number(uint);
      buf2.push([major | nuint]);
    } else if (uint < uintBoundaries[1]) {
      const nuint = Number(uint);
      buf2.push([
        major | 24,
        nuint
      ]);
    } else if (uint < uintBoundaries[2]) {
      const nuint = Number(uint);
      buf2.push([
        major | 25,
        nuint >>> 8,
        nuint & 255
      ]);
    } else if (uint < uintBoundaries[3]) {
      const nuint = Number(uint);
      buf2.push([
        major | 26,
        nuint >>> 24 & 255,
        nuint >>> 16 & 255,
        nuint >>> 8 & 255,
        nuint & 255
      ]);
    } else {
      const buint = BigInt(uint);
      if (buint < uintBoundaries[4]) {
        const set = [
          major | 27,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ];
        let lo = Number(buint & BigInt(4294967295));
        let hi = Number(buint >> BigInt(32) & BigInt(4294967295));
        set[8] = lo & 255;
        lo = lo >> 8;
        set[7] = lo & 255;
        lo = lo >> 8;
        set[6] = lo & 255;
        lo = lo >> 8;
        set[5] = lo & 255;
        set[4] = hi & 255;
        hi = hi >> 8;
        set[3] = hi & 255;
        hi = hi >> 8;
        set[2] = hi & 255;
        hi = hi >> 8;
        set[1] = hi & 255;
        buf2.push(set);
      } else {
        throw new Error(`${decodeErrPrefix} encountered BigInt larger than allowable range`);
      }
    }
  }
  encodeUint.encodedSize = function encodedSize(token) {
    return encodeUintValue.encodedSize(token.value);
  };
  encodeUintValue.encodedSize = function encodedSize2(uint) {
    if (uint < uintBoundaries[0]) {
      return 1;
    }
    if (uint < uintBoundaries[1]) {
      return 2;
    }
    if (uint < uintBoundaries[2]) {
      return 3;
    }
    if (uint < uintBoundaries[3]) {
      return 5;
    }
    return 9;
  };
  encodeUint.compareTokens = function compareTokens(tok1, tok2) {
    return tok1.value < tok2.value ? -1 : tok1.value > tok2.value ? 1 : 0;
  };

  // node_modules/cborg/esm/lib/1negint.js
  function decodeNegint8(data, pos, _minor, options) {
    return new Token(Type.negint, -1 - readUint8(data, pos + 1, options), 2);
  }
  function decodeNegint16(data, pos, _minor, options) {
    return new Token(Type.negint, -1 - readUint16(data, pos + 1, options), 3);
  }
  function decodeNegint32(data, pos, _minor, options) {
    return new Token(Type.negint, -1 - readUint32(data, pos + 1, options), 5);
  }
  var neg1b = BigInt(-1);
  var pos1b = BigInt(1);
  function decodeNegint64(data, pos, _minor, options) {
    const int = readUint64(data, pos + 1, options);
    if (typeof int !== "bigint") {
      const value = -1 - int;
      if (value >= Number.MIN_SAFE_INTEGER) {
        return new Token(Type.negint, value, 9);
      }
    }
    if (options.allowBigInt !== true) {
      throw new Error(`${decodeErrPrefix} integers outside of the safe integer range are not supported`);
    }
    return new Token(Type.negint, neg1b - BigInt(int), 9);
  }
  function encodeNegint(buf2, token) {
    const negint = token.value;
    const unsigned = typeof negint === "bigint" ? negint * neg1b - pos1b : negint * -1 - 1;
    encodeUintValue(buf2, token.type.majorEncoded, unsigned);
  }
  encodeNegint.encodedSize = function encodedSize3(token) {
    const negint = token.value;
    const unsigned = typeof negint === "bigint" ? negint * neg1b - pos1b : negint * -1 - 1;
    if (unsigned < uintBoundaries[0]) {
      return 1;
    }
    if (unsigned < uintBoundaries[1]) {
      return 2;
    }
    if (unsigned < uintBoundaries[2]) {
      return 3;
    }
    if (unsigned < uintBoundaries[3]) {
      return 5;
    }
    return 9;
  };
  encodeNegint.compareTokens = function compareTokens2(tok1, tok2) {
    return tok1.value < tok2.value ? 1 : tok1.value > tok2.value ? -1 : 0;
  };

  // node_modules/cborg/esm/lib/2bytes.js
  function toToken(data, pos, prefix, length4) {
    assertEnoughData(data, pos, prefix + length4);
    const buf2 = slice(data, pos + prefix, pos + prefix + length4);
    return new Token(Type.bytes, buf2, prefix + length4);
  }
  function decodeBytesCompact(data, pos, minor, _options) {
    return toToken(data, pos, 1, minor);
  }
  function decodeBytes8(data, pos, _minor, options) {
    return toToken(data, pos, 2, readUint8(data, pos + 1, options));
  }
  function decodeBytes16(data, pos, _minor, options) {
    return toToken(data, pos, 3, readUint16(data, pos + 1, options));
  }
  function decodeBytes32(data, pos, _minor, options) {
    return toToken(data, pos, 5, readUint32(data, pos + 1, options));
  }
  function decodeBytes64(data, pos, _minor, options) {
    const l = readUint64(data, pos + 1, options);
    if (typeof l === "bigint") {
      throw new Error(`${decodeErrPrefix} 64-bit integer bytes lengths not supported`);
    }
    return toToken(data, pos, 9, l);
  }
  function tokenBytes(token) {
    if (token.encodedBytes === void 0) {
      token.encodedBytes = token.type === Type.string ? fromString3(token.value) : token.value;
    }
    return token.encodedBytes;
  }
  function encodeBytes(buf2, token) {
    const bytes2 = tokenBytes(token);
    encodeUintValue(buf2, token.type.majorEncoded, bytes2.length);
    buf2.push(bytes2);
  }
  encodeBytes.encodedSize = function encodedSize4(token) {
    const bytes2 = tokenBytes(token);
    return encodeUintValue.encodedSize(bytes2.length) + bytes2.length;
  };
  encodeBytes.compareTokens = function compareTokens3(tok1, tok2) {
    return compareBytes(tokenBytes(tok1), tokenBytes(tok2));
  };
  function compareBytes(b1, b2) {
    return b1.length < b2.length ? -1 : b1.length > b2.length ? 1 : compare2(b1, b2);
  }

  // node_modules/cborg/esm/lib/3string.js
  function toToken2(data, pos, prefix, length4, options) {
    const totLength = prefix + length4;
    assertEnoughData(data, pos, totLength);
    const tok = new Token(Type.string, toString3(data, pos + prefix, pos + totLength), totLength);
    if (options.retainStringBytes === true) {
      tok.byteValue = slice(data, pos + prefix, pos + totLength);
    }
    return tok;
  }
  function decodeStringCompact(data, pos, minor, options) {
    return toToken2(data, pos, 1, minor, options);
  }
  function decodeString8(data, pos, _minor, options) {
    return toToken2(data, pos, 2, readUint8(data, pos + 1, options), options);
  }
  function decodeString16(data, pos, _minor, options) {
    return toToken2(data, pos, 3, readUint16(data, pos + 1, options), options);
  }
  function decodeString32(data, pos, _minor, options) {
    return toToken2(data, pos, 5, readUint32(data, pos + 1, options), options);
  }
  function decodeString64(data, pos, _minor, options) {
    const l = readUint64(data, pos + 1, options);
    if (typeof l === "bigint") {
      throw new Error(`${decodeErrPrefix} 64-bit integer string lengths not supported`);
    }
    return toToken2(data, pos, 9, l, options);
  }
  var encodeString = encodeBytes;

  // node_modules/cborg/esm/lib/4array.js
  function toToken3(_data, _pos, prefix, length4) {
    return new Token(Type.array, length4, prefix);
  }
  function decodeArrayCompact(data, pos, minor, _options) {
    return toToken3(data, pos, 1, minor);
  }
  function decodeArray8(data, pos, _minor, options) {
    return toToken3(data, pos, 2, readUint8(data, pos + 1, options));
  }
  function decodeArray16(data, pos, _minor, options) {
    return toToken3(data, pos, 3, readUint16(data, pos + 1, options));
  }
  function decodeArray32(data, pos, _minor, options) {
    return toToken3(data, pos, 5, readUint32(data, pos + 1, options));
  }
  function decodeArray64(data, pos, _minor, options) {
    const l = readUint64(data, pos + 1, options);
    if (typeof l === "bigint") {
      throw new Error(`${decodeErrPrefix} 64-bit integer array lengths not supported`);
    }
    return toToken3(data, pos, 9, l);
  }
  function decodeArrayIndefinite(data, pos, _minor, options) {
    if (options.allowIndefinite === false) {
      throw new Error(`${decodeErrPrefix} indefinite length items not allowed`);
    }
    return toToken3(data, pos, 1, Infinity);
  }
  function encodeArray(buf2, token) {
    encodeUintValue(buf2, Type.array.majorEncoded, token.value);
  }
  encodeArray.compareTokens = encodeUint.compareTokens;
  encodeArray.encodedSize = function encodedSize5(token) {
    return encodeUintValue.encodedSize(token.value);
  };

  // node_modules/cborg/esm/lib/5map.js
  function toToken4(_data, _pos, prefix, length4) {
    return new Token(Type.map, length4, prefix);
  }
  function decodeMapCompact(data, pos, minor, _options) {
    return toToken4(data, pos, 1, minor);
  }
  function decodeMap8(data, pos, _minor, options) {
    return toToken4(data, pos, 2, readUint8(data, pos + 1, options));
  }
  function decodeMap16(data, pos, _minor, options) {
    return toToken4(data, pos, 3, readUint16(data, pos + 1, options));
  }
  function decodeMap32(data, pos, _minor, options) {
    return toToken4(data, pos, 5, readUint32(data, pos + 1, options));
  }
  function decodeMap64(data, pos, _minor, options) {
    const l = readUint64(data, pos + 1, options);
    if (typeof l === "bigint") {
      throw new Error(`${decodeErrPrefix} 64-bit integer map lengths not supported`);
    }
    return toToken4(data, pos, 9, l);
  }
  function decodeMapIndefinite(data, pos, _minor, options) {
    if (options.allowIndefinite === false) {
      throw new Error(`${decodeErrPrefix} indefinite length items not allowed`);
    }
    return toToken4(data, pos, 1, Infinity);
  }
  function encodeMap(buf2, token) {
    encodeUintValue(buf2, Type.map.majorEncoded, token.value);
  }
  encodeMap.compareTokens = encodeUint.compareTokens;
  encodeMap.encodedSize = function encodedSize6(token) {
    return encodeUintValue.encodedSize(token.value);
  };

  // node_modules/cborg/esm/lib/6tag.js
  function decodeTagCompact(_data, _pos, minor, _options) {
    return new Token(Type.tag, minor, 1);
  }
  function decodeTag8(data, pos, _minor, options) {
    return new Token(Type.tag, readUint8(data, pos + 1, options), 2);
  }
  function decodeTag16(data, pos, _minor, options) {
    return new Token(Type.tag, readUint16(data, pos + 1, options), 3);
  }
  function decodeTag32(data, pos, _minor, options) {
    return new Token(Type.tag, readUint32(data, pos + 1, options), 5);
  }
  function decodeTag64(data, pos, _minor, options) {
    return new Token(Type.tag, readUint64(data, pos + 1, options), 9);
  }
  function encodeTag(buf2, token) {
    encodeUintValue(buf2, Type.tag.majorEncoded, token.value);
  }
  encodeTag.compareTokens = encodeUint.compareTokens;
  encodeTag.encodedSize = function encodedSize7(token) {
    return encodeUintValue.encodedSize(token.value);
  };

  // node_modules/cborg/esm/lib/7float.js
  var MINOR_FALSE = 20;
  var MINOR_TRUE = 21;
  var MINOR_NULL = 22;
  var MINOR_UNDEFINED = 23;
  function decodeUndefined(_data, _pos, _minor, options) {
    if (options.allowUndefined === false) {
      throw new Error(`${decodeErrPrefix} undefined values are not supported`);
    } else if (options.coerceUndefinedToNull === true) {
      return new Token(Type.null, null, 1);
    }
    return new Token(Type.undefined, void 0, 1);
  }
  function decodeBreak(_data, _pos, _minor, options) {
    if (options.allowIndefinite === false) {
      throw new Error(`${decodeErrPrefix} indefinite length items not allowed`);
    }
    return new Token(Type.break, void 0, 1);
  }
  function createToken(value, bytes2, options) {
    if (options) {
      if (options.allowNaN === false && Number.isNaN(value)) {
        throw new Error(`${decodeErrPrefix} NaN values are not supported`);
      }
      if (options.allowInfinity === false && (value === Infinity || value === -Infinity)) {
        throw new Error(`${decodeErrPrefix} Infinity values are not supported`);
      }
    }
    return new Token(Type.float, value, bytes2);
  }
  function decodeFloat16(data, pos, _minor, options) {
    return createToken(readFloat16(data, pos + 1), 3, options);
  }
  function decodeFloat32(data, pos, _minor, options) {
    return createToken(readFloat32(data, pos + 1), 5, options);
  }
  function decodeFloat64(data, pos, _minor, options) {
    return createToken(readFloat64(data, pos + 1), 9, options);
  }
  function encodeFloat(buf2, token, options) {
    const float = token.value;
    if (float === false) {
      buf2.push([Type.float.majorEncoded | MINOR_FALSE]);
    } else if (float === true) {
      buf2.push([Type.float.majorEncoded | MINOR_TRUE]);
    } else if (float === null) {
      buf2.push([Type.float.majorEncoded | MINOR_NULL]);
    } else if (float === void 0) {
      buf2.push([Type.float.majorEncoded | MINOR_UNDEFINED]);
    } else {
      let decoded;
      let success = false;
      if (!options || options.float64 !== true) {
        encodeFloat16(float);
        decoded = readFloat16(ui8a, 1);
        if (float === decoded || Number.isNaN(float)) {
          ui8a[0] = 249;
          buf2.push(ui8a.slice(0, 3));
          success = true;
        } else {
          encodeFloat32(float);
          decoded = readFloat32(ui8a, 1);
          if (float === decoded) {
            ui8a[0] = 250;
            buf2.push(ui8a.slice(0, 5));
            success = true;
          }
        }
      }
      if (!success) {
        encodeFloat64(float);
        decoded = readFloat64(ui8a, 1);
        ui8a[0] = 251;
        buf2.push(ui8a.slice(0, 9));
      }
    }
  }
  encodeFloat.encodedSize = function encodedSize8(token, options) {
    const float = token.value;
    if (float === false || float === true || float === null || float === void 0) {
      return 1;
    }
    if (!options || options.float64 !== true) {
      encodeFloat16(float);
      let decoded = readFloat16(ui8a, 1);
      if (float === decoded || Number.isNaN(float)) {
        return 3;
      }
      encodeFloat32(float);
      decoded = readFloat32(ui8a, 1);
      if (float === decoded) {
        return 5;
      }
    }
    return 9;
  };
  var buffer = new ArrayBuffer(9);
  var dataView = new DataView(buffer, 1);
  var ui8a = new Uint8Array(buffer, 0);
  function encodeFloat16(inp) {
    if (inp === Infinity) {
      dataView.setUint16(0, 31744, false);
    } else if (inp === -Infinity) {
      dataView.setUint16(0, 64512, false);
    } else if (Number.isNaN(inp)) {
      dataView.setUint16(0, 32256, false);
    } else {
      dataView.setFloat32(0, inp);
      const valu32 = dataView.getUint32(0);
      const exponent = (valu32 & 2139095040) >> 23;
      const mantissa = valu32 & 8388607;
      if (exponent === 255) {
        dataView.setUint16(0, 31744, false);
      } else if (exponent === 0) {
        dataView.setUint16(0, (inp & 2147483648) >> 16 | mantissa >> 13, false);
      } else {
        const logicalExponent = exponent - 127;
        if (logicalExponent < -24) {
          dataView.setUint16(0, 0);
        } else if (logicalExponent < -14) {
          dataView.setUint16(0, (valu32 & 2147483648) >> 16 | 1 << 24 + logicalExponent, false);
        } else {
          dataView.setUint16(0, (valu32 & 2147483648) >> 16 | logicalExponent + 15 << 10 | mantissa >> 13, false);
        }
      }
    }
  }
  function readFloat16(ui8a2, pos) {
    if (ui8a2.length - pos < 2) {
      throw new Error(`${decodeErrPrefix} not enough data for float16`);
    }
    const half = (ui8a2[pos] << 8) + ui8a2[pos + 1];
    if (half === 31744) {
      return Infinity;
    }
    if (half === 64512) {
      return -Infinity;
    }
    if (half === 32256) {
      return NaN;
    }
    const exp = half >> 10 & 31;
    const mant = half & 1023;
    let val;
    if (exp === 0) {
      val = mant * 2 ** -24;
    } else if (exp !== 31) {
      val = (mant + 1024) * 2 ** (exp - 25);
    } else {
      val = mant === 0 ? Infinity : NaN;
    }
    return half & 32768 ? -val : val;
  }
  function encodeFloat32(inp) {
    dataView.setFloat32(0, inp, false);
  }
  function readFloat32(ui8a2, pos) {
    if (ui8a2.length - pos < 4) {
      throw new Error(`${decodeErrPrefix} not enough data for float32`);
    }
    const offset = (ui8a2.byteOffset || 0) + pos;
    return new DataView(ui8a2.buffer, offset, 4).getFloat32(0, false);
  }
  function encodeFloat64(inp) {
    dataView.setFloat64(0, inp, false);
  }
  function readFloat64(ui8a2, pos) {
    if (ui8a2.length - pos < 8) {
      throw new Error(`${decodeErrPrefix} not enough data for float64`);
    }
    const offset = (ui8a2.byteOffset || 0) + pos;
    return new DataView(ui8a2.buffer, offset, 8).getFloat64(0, false);
  }
  encodeFloat.compareTokens = encodeUint.compareTokens;

  // node_modules/cborg/esm/lib/jump.js
  function invalidMinor(data, pos, minor) {
    throw new Error(`${decodeErrPrefix} encountered invalid minor (${minor}) for major ${data[pos] >>> 5}`);
  }
  function errorer(msg) {
    return () => {
      throw new Error(`${decodeErrPrefix} ${msg}`);
    };
  }
  var jump = [];
  for (let i = 0; i <= 23; i++) {
    jump[i] = invalidMinor;
  }
  jump[24] = decodeUint8;
  jump[25] = decodeUint16;
  jump[26] = decodeUint32;
  jump[27] = decodeUint64;
  jump[28] = invalidMinor;
  jump[29] = invalidMinor;
  jump[30] = invalidMinor;
  jump[31] = invalidMinor;
  for (let i = 32; i <= 55; i++) {
    jump[i] = invalidMinor;
  }
  jump[56] = decodeNegint8;
  jump[57] = decodeNegint16;
  jump[58] = decodeNegint32;
  jump[59] = decodeNegint64;
  jump[60] = invalidMinor;
  jump[61] = invalidMinor;
  jump[62] = invalidMinor;
  jump[63] = invalidMinor;
  for (let i = 64; i <= 87; i++) {
    jump[i] = decodeBytesCompact;
  }
  jump[88] = decodeBytes8;
  jump[89] = decodeBytes16;
  jump[90] = decodeBytes32;
  jump[91] = decodeBytes64;
  jump[92] = invalidMinor;
  jump[93] = invalidMinor;
  jump[94] = invalidMinor;
  jump[95] = errorer("indefinite length bytes/strings are not supported");
  for (let i = 96; i <= 119; i++) {
    jump[i] = decodeStringCompact;
  }
  jump[120] = decodeString8;
  jump[121] = decodeString16;
  jump[122] = decodeString32;
  jump[123] = decodeString64;
  jump[124] = invalidMinor;
  jump[125] = invalidMinor;
  jump[126] = invalidMinor;
  jump[127] = errorer("indefinite length bytes/strings are not supported");
  for (let i = 128; i <= 151; i++) {
    jump[i] = decodeArrayCompact;
  }
  jump[152] = decodeArray8;
  jump[153] = decodeArray16;
  jump[154] = decodeArray32;
  jump[155] = decodeArray64;
  jump[156] = invalidMinor;
  jump[157] = invalidMinor;
  jump[158] = invalidMinor;
  jump[159] = decodeArrayIndefinite;
  for (let i = 160; i <= 183; i++) {
    jump[i] = decodeMapCompact;
  }
  jump[184] = decodeMap8;
  jump[185] = decodeMap16;
  jump[186] = decodeMap32;
  jump[187] = decodeMap64;
  jump[188] = invalidMinor;
  jump[189] = invalidMinor;
  jump[190] = invalidMinor;
  jump[191] = decodeMapIndefinite;
  for (let i = 192; i <= 215; i++) {
    jump[i] = decodeTagCompact;
  }
  jump[216] = decodeTag8;
  jump[217] = decodeTag16;
  jump[218] = decodeTag32;
  jump[219] = decodeTag64;
  jump[220] = invalidMinor;
  jump[221] = invalidMinor;
  jump[222] = invalidMinor;
  jump[223] = invalidMinor;
  for (let i = 224; i <= 243; i++) {
    jump[i] = errorer("simple values are not supported");
  }
  jump[244] = invalidMinor;
  jump[245] = invalidMinor;
  jump[246] = invalidMinor;
  jump[247] = decodeUndefined;
  jump[248] = errorer("simple values are not supported");
  jump[249] = decodeFloat16;
  jump[250] = decodeFloat32;
  jump[251] = decodeFloat64;
  jump[252] = invalidMinor;
  jump[253] = invalidMinor;
  jump[254] = invalidMinor;
  jump[255] = decodeBreak;
  var quick = [];
  for (let i = 0; i < 24; i++) {
    quick[i] = new Token(Type.uint, i, 1);
  }
  for (let i = -1; i >= -24; i--) {
    quick[31 - i] = new Token(Type.negint, i, 1);
  }
  quick[64] = new Token(Type.bytes, new Uint8Array(0), 1);
  quick[96] = new Token(Type.string, "", 1);
  quick[128] = new Token(Type.array, 0, 1);
  quick[160] = new Token(Type.map, 0, 1);
  quick[244] = new Token(Type.false, false, 1);
  quick[245] = new Token(Type.true, true, 1);
  quick[246] = new Token(Type.null, null, 1);
  function quickEncodeToken(token) {
    switch (token.type) {
      case Type.false:
        return fromArray([244]);
      case Type.true:
        return fromArray([245]);
      case Type.null:
        return fromArray([246]);
      case Type.bytes:
        if (!token.value.length) {
          return fromArray([64]);
        }
        return;
      case Type.string:
        if (token.value === "") {
          return fromArray([96]);
        }
        return;
      case Type.array:
        if (token.value === 0) {
          return fromArray([128]);
        }
        return;
      case Type.map:
        if (token.value === 0) {
          return fromArray([160]);
        }
        return;
      case Type.uint:
        if (token.value < 24) {
          return fromArray([Number(token.value)]);
        }
        return;
      case Type.negint:
        if (token.value >= -24) {
          return fromArray([31 - Number(token.value)]);
        }
    }
  }

  // node_modules/cborg/esm/lib/encode.js
  var defaultEncodeOptions = {
    float64: false,
    mapSorter,
    quickEncodeToken
  };
  function makeCborEncoders() {
    const encoders = [];
    encoders[Type.uint.major] = encodeUint;
    encoders[Type.negint.major] = encodeNegint;
    encoders[Type.bytes.major] = encodeBytes;
    encoders[Type.string.major] = encodeString;
    encoders[Type.array.major] = encodeArray;
    encoders[Type.map.major] = encodeMap;
    encoders[Type.tag.major] = encodeTag;
    encoders[Type.float.major] = encodeFloat;
    return encoders;
  }
  var cborEncoders = makeCborEncoders();
  var buf = new Bl();
  var Ref = class {
    constructor(obj, parent) {
      this.obj = obj;
      this.parent = parent;
    }
    includes(obj) {
      let p = this;
      do {
        if (p.obj === obj) {
          return true;
        }
      } while (p = p.parent);
      return false;
    }
    static createCheck(stack, obj) {
      if (stack && stack.includes(obj)) {
        throw new Error(`${encodeErrPrefix} object contains circular references`);
      }
      return new Ref(obj, stack);
    }
  };
  var simpleTokens = {
    null: new Token(Type.null, null),
    undefined: new Token(Type.undefined, void 0),
    true: new Token(Type.true, true),
    false: new Token(Type.false, false),
    emptyArray: new Token(Type.array, 0),
    emptyMap: new Token(Type.map, 0)
  };
  var typeEncoders = {
    number(obj, _typ, _options, _refStack) {
      if (!Number.isInteger(obj) || !Number.isSafeInteger(obj)) {
        return new Token(Type.float, obj);
      } else if (obj >= 0) {
        return new Token(Type.uint, obj);
      } else {
        return new Token(Type.negint, obj);
      }
    },
    bigint(obj, _typ, _options, _refStack) {
      if (obj >= BigInt(0)) {
        return new Token(Type.uint, obj);
      } else {
        return new Token(Type.negint, obj);
      }
    },
    Uint8Array(obj, _typ, _options, _refStack) {
      return new Token(Type.bytes, obj);
    },
    string(obj, _typ, _options, _refStack) {
      return new Token(Type.string, obj);
    },
    boolean(obj, _typ, _options, _refStack) {
      return obj ? simpleTokens.true : simpleTokens.false;
    },
    null(_obj, _typ, _options, _refStack) {
      return simpleTokens.null;
    },
    undefined(_obj, _typ, _options, _refStack) {
      return simpleTokens.undefined;
    },
    ArrayBuffer(obj, _typ, _options, _refStack) {
      return new Token(Type.bytes, new Uint8Array(obj));
    },
    DataView(obj, _typ, _options, _refStack) {
      return new Token(Type.bytes, new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength));
    },
    Array(obj, _typ, options, refStack) {
      if (!obj.length) {
        if (options.addBreakTokens === true) {
          return [
            simpleTokens.emptyArray,
            new Token(Type.break)
          ];
        }
        return simpleTokens.emptyArray;
      }
      refStack = Ref.createCheck(refStack, obj);
      const entries = [];
      let i = 0;
      for (const e of obj) {
        entries[i++] = objectToTokens(e, options, refStack);
      }
      if (options.addBreakTokens) {
        return [
          new Token(Type.array, obj.length),
          entries,
          new Token(Type.break)
        ];
      }
      return [
        new Token(Type.array, obj.length),
        entries
      ];
    },
    Object(obj, typ, options, refStack) {
      const isMap = typ !== "Object";
      const keys = isMap ? obj.keys() : Object.keys(obj);
      const length4 = isMap ? obj.size : keys.length;
      if (!length4) {
        if (options.addBreakTokens === true) {
          return [
            simpleTokens.emptyMap,
            new Token(Type.break)
          ];
        }
        return simpleTokens.emptyMap;
      }
      refStack = Ref.createCheck(refStack, obj);
      const entries = [];
      let i = 0;
      for (const key of keys) {
        entries[i++] = [
          objectToTokens(key, options, refStack),
          objectToTokens(isMap ? obj.get(key) : obj[key], options, refStack)
        ];
      }
      sortMapEntries(entries, options);
      if (options.addBreakTokens) {
        return [
          new Token(Type.map, length4),
          entries,
          new Token(Type.break)
        ];
      }
      return [
        new Token(Type.map, length4),
        entries
      ];
    }
  };
  typeEncoders.Map = typeEncoders.Object;
  typeEncoders.Buffer = typeEncoders.Uint8Array;
  for (const typ of "Uint8Clamped Uint16 Uint32 Int8 Int16 Int32 BigUint64 BigInt64 Float32 Float64".split(" ")) {
    typeEncoders[`${typ}Array`] = typeEncoders.DataView;
  }
  function objectToTokens(obj, options = {}, refStack) {
    const typ = is(obj);
    const customTypeEncoder = options && options.typeEncoders && options.typeEncoders[typ] || typeEncoders[typ];
    if (typeof customTypeEncoder === "function") {
      const tokens = customTypeEncoder(obj, typ, options, refStack);
      if (tokens != null) {
        return tokens;
      }
    }
    const typeEncoder = typeEncoders[typ];
    if (!typeEncoder) {
      throw new Error(`${encodeErrPrefix} unsupported type: ${typ}`);
    }
    return typeEncoder(obj, typ, options, refStack);
  }
  function sortMapEntries(entries, options) {
    if (options.mapSorter) {
      entries.sort(options.mapSorter);
    }
  }
  function mapSorter(e1, e2) {
    const keyToken1 = Array.isArray(e1[0]) ? e1[0][0] : e1[0];
    const keyToken2 = Array.isArray(e2[0]) ? e2[0][0] : e2[0];
    if (keyToken1.type !== keyToken2.type) {
      return keyToken1.type.compare(keyToken2.type);
    }
    const major = keyToken1.type.major;
    const tcmp = cborEncoders[major].compareTokens(keyToken1, keyToken2);
    if (tcmp === 0) {
      console.warn("WARNING: complex key types used, CBOR key sorting guarantees are gone");
    }
    return tcmp;
  }
  function tokensToEncoded(buf2, tokens, encoders, options) {
    if (Array.isArray(tokens)) {
      for (const token of tokens) {
        tokensToEncoded(buf2, token, encoders, options);
      }
    } else {
      encoders[tokens.type.major](buf2, tokens, options);
    }
  }
  function encodeCustom(data, encoders, options) {
    const tokens = objectToTokens(data, options);
    if (!Array.isArray(tokens) && options.quickEncodeToken) {
      const quickBytes = options.quickEncodeToken(tokens);
      if (quickBytes) {
        return quickBytes;
      }
      const encoder = encoders[tokens.type.major];
      if (encoder.encodedSize) {
        const size = encoder.encodedSize(tokens, options);
        const buf2 = new Bl(size);
        encoder(buf2, tokens, options);
        if (buf2.chunks.length !== 1) {
          throw new Error(`Unexpected error: pre-calculated length for ${tokens} was wrong`);
        }
        return asU8A(buf2.chunks[0]);
      }
    }
    buf.reset();
    tokensToEncoded(buf, tokens, encoders, options);
    return buf.toBytes(true);
  }
  function encode5(data, options) {
    options = Object.assign({}, defaultEncodeOptions, options);
    return encodeCustom(data, cborEncoders, options);
  }

  // node_modules/cborg/esm/lib/decode.js
  var defaultDecodeOptions = {
    strict: false,
    allowIndefinite: true,
    allowUndefined: true,
    allowBigInt: true
  };
  var Tokeniser = class {
    constructor(data, options = {}) {
      this.pos = 0;
      this.data = data;
      this.options = options;
    }
    done() {
      return this.pos >= this.data.length;
    }
    next() {
      const byt = this.data[this.pos];
      let token = quick[byt];
      if (token === void 0) {
        const decoder = jump[byt];
        if (!decoder) {
          throw new Error(`${decodeErrPrefix} no decoder for major type ${byt >>> 5} (byte 0x${byt.toString(16).padStart(2, "0")})`);
        }
        const minor = byt & 31;
        token = decoder(this.data, this.pos, minor, this.options);
      }
      this.pos += token.encodedLength;
      return token;
    }
  };
  var DONE = Symbol.for("DONE");
  var BREAK = Symbol.for("BREAK");
  function tokenToArray(token, tokeniser, options) {
    const arr = [];
    for (let i = 0; i < token.value; i++) {
      const value = tokensToObject(tokeniser, options);
      if (value === BREAK) {
        if (token.value === Infinity) {
          break;
        }
        throw new Error(`${decodeErrPrefix} got unexpected break to lengthed array`);
      }
      if (value === DONE) {
        throw new Error(`${decodeErrPrefix} found array but not enough entries (got ${i}, expected ${token.value})`);
      }
      arr[i] = value;
    }
    return arr;
  }
  function tokenToMap(token, tokeniser, options) {
    const useMaps = options.useMaps === true;
    const obj = useMaps ? void 0 : {};
    const m = useMaps ? /* @__PURE__ */ new Map() : void 0;
    for (let i = 0; i < token.value; i++) {
      const key = tokensToObject(tokeniser, options);
      if (key === BREAK) {
        if (token.value === Infinity) {
          break;
        }
        throw new Error(`${decodeErrPrefix} got unexpected break to lengthed map`);
      }
      if (key === DONE) {
        throw new Error(`${decodeErrPrefix} found map but not enough entries (got ${i} [no key], expected ${token.value})`);
      }
      if (useMaps !== true && typeof key !== "string") {
        throw new Error(`${decodeErrPrefix} non-string keys not supported (got ${typeof key})`);
      }
      if (options.rejectDuplicateMapKeys === true) {
        if (useMaps && m.has(key) || !useMaps && key in obj) {
          throw new Error(`${decodeErrPrefix} found repeat map key "${key}"`);
        }
      }
      const value = tokensToObject(tokeniser, options);
      if (value === DONE) {
        throw new Error(`${decodeErrPrefix} found map but not enough entries (got ${i} [no value], expected ${token.value})`);
      }
      if (useMaps) {
        m.set(key, value);
      } else {
        obj[key] = value;
      }
    }
    return useMaps ? m : obj;
  }
  function tokensToObject(tokeniser, options) {
    if (tokeniser.done()) {
      return DONE;
    }
    const token = tokeniser.next();
    if (token.type === Type.break) {
      return BREAK;
    }
    if (token.type.terminal) {
      return token.value;
    }
    if (token.type === Type.array) {
      return tokenToArray(token, tokeniser, options);
    }
    if (token.type === Type.map) {
      return tokenToMap(token, tokeniser, options);
    }
    if (token.type === Type.tag) {
      if (options.tags && typeof options.tags[token.value] === "function") {
        const tagged = tokensToObject(tokeniser, options);
        return options.tags[token.value](tagged);
      }
      throw new Error(`${decodeErrPrefix} tag not supported (${token.value})`);
    }
    throw new Error("unsupported");
  }
  function decode6(data, options) {
    if (!(data instanceof Uint8Array)) {
      throw new Error(`${decodeErrPrefix} data to decode must be a Uint8Array`);
    }
    options = Object.assign({}, defaultDecodeOptions, options);
    const tokeniser = options.tokenizer || new Tokeniser(data, options);
    const decoded = tokensToObject(tokeniser, options);
    if (decoded === DONE) {
      throw new Error(`${decodeErrPrefix} did not find any content to decode`);
    }
    if (decoded === BREAK) {
      throw new Error(`${decodeErrPrefix} got unexpected break`);
    }
    if (!tokeniser.done()) {
      throw new Error(`${decodeErrPrefix} too many terminals, data makes no sense`);
    }
    return decoded;
  }

  // node_modules/@ipld/dag-cbor/esm/index.js
  var CID_CBOR_TAG = 42;
  function cidEncoder(obj) {
    if (obj.asCID !== obj) {
      return null;
    }
    const cid = CID.asCID(obj);
    if (!cid) {
      return null;
    }
    const bytes2 = new Uint8Array(cid.bytes.byteLength + 1);
    bytes2.set(cid.bytes, 1);
    return [
      new Token(Type.tag, CID_CBOR_TAG),
      new Token(Type.bytes, bytes2)
    ];
  }
  function undefinedEncoder() {
    throw new Error("`undefined` is not supported by the IPLD Data Model and cannot be encoded");
  }
  function numberEncoder(num) {
    if (Number.isNaN(num)) {
      throw new Error("`NaN` is not supported by the IPLD Data Model and cannot be encoded");
    }
    if (num === Infinity || num === -Infinity) {
      throw new Error("`Infinity` and `-Infinity` is not supported by the IPLD Data Model and cannot be encoded");
    }
    return null;
  }
  var encodeOptions = {
    float64: true,
    typeEncoders: {
      Object: cidEncoder,
      undefined: undefinedEncoder,
      number: numberEncoder
    }
  };
  function cidDecoder(bytes2) {
    if (bytes2[0] !== 0) {
      throw new Error("Invalid CID for CBOR tag 42; expected leading 0x00");
    }
    return CID.decode(bytes2.subarray(1));
  }
  var decodeOptions = {
    allowIndefinite: false,
    coerceUndefinedToNull: true,
    allowNaN: false,
    allowInfinity: false,
    allowBigInt: true,
    strict: true,
    useMaps: false,
    tags: []
  };
  decodeOptions.tags[CID_CBOR_TAG] = cidDecoder;
  var name2 = "dag-cbor";
  var code2 = 113;
  var encode6 = (node) => encode5(node, encodeOptions);
  var decode7 = (data) => decode6(data, decodeOptions);

  // node_modules/multiformats/esm/src/block.js
  var readonly2 = ({ enumerable = true, configurable = false } = {}) => ({
    enumerable,
    configurable,
    writable: false
  });
  var links = function* (source, base4) {
    if (source == null)
      return;
    if (source instanceof Uint8Array)
      return;
    for (const [key, value] of Object.entries(source)) {
      const path = [
        ...base4,
        key
      ];
      if (value != null && typeof value === "object") {
        if (Array.isArray(value)) {
          for (const [index, element] of value.entries()) {
            const elementPath = [
              ...path,
              index
            ];
            const cid = CID.asCID(element);
            if (cid) {
              yield [
                elementPath.join("/"),
                cid
              ];
            } else if (typeof element === "object") {
              yield* links(element, elementPath);
            }
          }
        } else {
          const cid = CID.asCID(value);
          if (cid) {
            yield [
              path.join("/"),
              cid
            ];
          } else {
            yield* links(value, path);
          }
        }
      }
    }
  };
  var tree = function* (source, base4) {
    if (source == null)
      return;
    for (const [key, value] of Object.entries(source)) {
      const path = [
        ...base4,
        key
      ];
      yield path.join("/");
      if (value != null && !(value instanceof Uint8Array) && typeof value === "object" && !CID.asCID(value)) {
        if (Array.isArray(value)) {
          for (const [index, element] of value.entries()) {
            const elementPath = [
              ...path,
              index
            ];
            yield elementPath.join("/");
            if (typeof element === "object" && !CID.asCID(element)) {
              yield* tree(element, elementPath);
            }
          }
        } else {
          yield* tree(value, path);
        }
      }
    }
  };
  var get = (source, path) => {
    let node = source;
    for (const [index, key] of path.entries()) {
      node = node[key];
      if (node == null) {
        throw new Error(`Object has no property at ${path.slice(0, index + 1).map((part) => `[${JSON.stringify(part)}]`).join("")}`);
      }
      const cid = CID.asCID(node);
      if (cid) {
        return {
          value: cid,
          remaining: path.slice(index + 1).join("/")
        };
      }
    }
    return { value: node };
  };
  var Block = class {
    constructor({ cid, bytes: bytes2, value }) {
      if (!cid || !bytes2 || typeof value === "undefined")
        throw new Error("Missing required argument");
      this.cid = cid;
      this.bytes = bytes2;
      this.value = value;
      this.asBlock = this;
      Object.defineProperties(this, {
        cid: readonly2(),
        bytes: readonly2(),
        value: readonly2(),
        asBlock: readonly2()
      });
    }
    links() {
      return links(this.value, []);
    }
    tree() {
      return tree(this.value, []);
    }
    get(path = "/") {
      return get(this.value, path.split("/").filter(Boolean));
    }
  };
  var encode7 = async ({ value, codec, hasher }) => {
    if (typeof value === "undefined")
      throw new Error('Missing required argument "value"');
    if (!codec || !hasher)
      throw new Error("Missing required argument: codec or hasher");
    const bytes2 = codec.encode(value);
    const hash3 = await hasher.digest(bytes2);
    const cid = CID.create(1, codec.code, hash3);
    return new Block({
      value,
      bytes: bytes2,
      cid
    });
  };

  // node_modules/@noble/hashes/esm/_assert.js
  function number(n) {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error(`Wrong positive integer: ${n}`);
  }
  function bool(b) {
    if (typeof b !== "boolean")
      throw new Error(`Expected boolean, not ${b}`);
  }
  function bytes(b, ...lengths) {
    if (!(b instanceof Uint8Array))
      throw new TypeError("Expected Uint8Array");
    if (lengths.length > 0 && !lengths.includes(b.length))
      throw new TypeError(`Expected Uint8Array of length ${lengths}, not of length=${b.length}`);
  }
  function hash(hash3) {
    if (typeof hash3 !== "function" || typeof hash3.create !== "function")
      throw new Error("Hash should be wrapped by utils.wrapConstructor");
    number(hash3.outputLen);
    number(hash3.blockLen);
  }
  function exists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function output(out, instance) {
    bytes(out);
    const min = instance.outputLen;
    if (out.length < min) {
      throw new Error(`digestInto() expects output buffer of length at least ${min}`);
    }
  }
  var assert = {
    number,
    bool,
    bytes,
    hash,
    exists,
    output
  };
  var assert_default = assert;

  // node_modules/@noble/hashes/esm/crypto.js
  var crypto2 = typeof globalThis === "object" && "crypto" in globalThis ? globalThis.crypto : void 0;

  // node_modules/@noble/hashes/esm/utils.js
  var createView = (arr) => new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  var rotr = (word, shift) => word << 32 - shift | word >>> shift;
  var isLE = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
  if (!isLE)
    throw new Error("Non little-endian hardware is not supported");
  var hexes = Array.from({ length: 256 }, (v, i) => i.toString(16).padStart(2, "0"));
  function utf8ToBytes2(str) {
    if (typeof str !== "string") {
      throw new TypeError(`utf8ToBytes expected string, got ${typeof str}`);
    }
    return new TextEncoder().encode(str);
  }
  function toBytes(data) {
    if (typeof data === "string")
      data = utf8ToBytes2(data);
    if (!(data instanceof Uint8Array))
      throw new TypeError(`Expected input type is Uint8Array (got ${typeof data})`);
    return data;
  }
  var Hash = class {
    // Safe version that clones internal state
    clone() {
      return this._cloneInto();
    }
  };
  function wrapConstructor(hashConstructor) {
    const hashC = (message) => hashConstructor().update(toBytes(message)).digest();
    const tmp = hashConstructor();
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = () => hashConstructor();
    return hashC;
  }

  // node_modules/@noble/hashes/esm/_sha2.js
  function setBigUint64(view, byteOffset, value, isLE2) {
    if (typeof view.setBigUint64 === "function")
      return view.setBigUint64(byteOffset, value, isLE2);
    const _32n2 = BigInt(32);
    const _u32_max = BigInt(4294967295);
    const wh = Number(value >> _32n2 & _u32_max);
    const wl = Number(value & _u32_max);
    const h = isLE2 ? 4 : 0;
    const l = isLE2 ? 0 : 4;
    view.setUint32(byteOffset + h, wh, isLE2);
    view.setUint32(byteOffset + l, wl, isLE2);
  }
  var SHA2 = class extends Hash {
    constructor(blockLen, outputLen, padOffset, isLE2) {
      super();
      this.blockLen = blockLen;
      this.outputLen = outputLen;
      this.padOffset = padOffset;
      this.isLE = isLE2;
      this.finished = false;
      this.length = 0;
      this.pos = 0;
      this.destroyed = false;
      this.buffer = new Uint8Array(blockLen);
      this.view = createView(this.buffer);
    }
    update(data) {
      assert_default.exists(this);
      const { view, buffer: buffer2, blockLen } = this;
      data = toBytes(data);
      const len = data.length;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          const dataView2 = createView(data);
          for (; blockLen <= len - pos; pos += blockLen)
            this.process(dataView2, pos);
          continue;
        }
        buffer2.set(data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        pos += take;
        if (this.pos === blockLen) {
          this.process(view, 0);
          this.pos = 0;
        }
      }
      this.length += data.length;
      this.roundClean();
      return this;
    }
    digestInto(out) {
      assert_default.exists(this);
      assert_default.output(out, this);
      this.finished = true;
      const { buffer: buffer2, view, blockLen, isLE: isLE2 } = this;
      let { pos } = this;
      buffer2[pos++] = 128;
      this.buffer.subarray(pos).fill(0);
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        pos = 0;
      }
      for (let i = pos; i < blockLen; i++)
        buffer2[i] = 0;
      setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE2);
      this.process(view, 0);
      const oview = createView(out);
      const len = this.outputLen;
      if (len % 4)
        throw new Error("_sha2: outputLen should be aligned to 32bit");
      const outLen = len / 4;
      const state = this.get();
      if (outLen > state.length)
        throw new Error("_sha2: outputLen bigger than state");
      for (let i = 0; i < outLen; i++)
        oview.setUint32(4 * i, state[i], isLE2);
    }
    digest() {
      const { buffer: buffer2, outputLen } = this;
      this.digestInto(buffer2);
      const res = buffer2.slice(0, outputLen);
      this.destroy();
      return res;
    }
    _cloneInto(to) {
      to || (to = new this.constructor());
      to.set(...this.get());
      const { blockLen, buffer: buffer2, length: length4, finished, destroyed, pos } = this;
      to.length = length4;
      to.pos = pos;
      to.finished = finished;
      to.destroyed = destroyed;
      if (length4 % blockLen)
        to.buffer.set(buffer2);
      return to;
    }
  };

  // node_modules/@noble/hashes/esm/sha256.js
  var Chi = (a, b, c) => a & b ^ ~a & c;
  var Maj = (a, b, c) => a & b ^ a & c ^ b & c;
  var SHA256_K = new Uint32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var IV = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  var SHA256_W = new Uint32Array(64);
  var SHA256 = class extends SHA2 {
    constructor() {
      super(64, 32, 8, false);
      this.A = IV[0] | 0;
      this.B = IV[1] | 0;
      this.C = IV[2] | 0;
      this.D = IV[3] | 0;
      this.E = IV[4] | 0;
      this.F = IV[5] | 0;
      this.G = IV[6] | 0;
      this.H = IV[7] | 0;
    }
    get() {
      const { A, B, C, D, E, F, G, H } = this;
      return [A, B, C, D, E, F, G, H];
    }
    // prettier-ignore
    set(A, B, C, D, E, F, G, H) {
      this.A = A | 0;
      this.B = B | 0;
      this.C = C | 0;
      this.D = D | 0;
      this.E = E | 0;
      this.F = F | 0;
      this.G = G | 0;
      this.H = H | 0;
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 4)
        SHA256_W[i] = view.getUint32(offset, false);
      for (let i = 16; i < 64; i++) {
        const W15 = SHA256_W[i - 15];
        const W2 = SHA256_W[i - 2];
        const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
        const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
        SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
      }
      let { A, B, C, D, E, F, G, H } = this;
      for (let i = 0; i < 64; i++) {
        const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
        const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
        const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
        const T2 = sigma0 + Maj(A, B, C) | 0;
        H = G;
        G = F;
        F = E;
        E = D + T1 | 0;
        D = C;
        C = B;
        B = A;
        A = T1 + T2 | 0;
      }
      A = A + this.A | 0;
      B = B + this.B | 0;
      C = C + this.C | 0;
      D = D + this.D | 0;
      E = E + this.E | 0;
      F = F + this.F | 0;
      G = G + this.G | 0;
      H = H + this.H | 0;
      this.set(A, B, C, D, E, F, G, H);
    }
    roundClean() {
      SHA256_W.fill(0);
    }
    destroy() {
      this.set(0, 0, 0, 0, 0, 0, 0, 0);
      this.buffer.fill(0);
    }
  };
  var SHA224 = class extends SHA256 {
    constructor() {
      super();
      this.A = 3238371032 | 0;
      this.B = 914150663 | 0;
      this.C = 812702999 | 0;
      this.D = 4144912697 | 0;
      this.E = 4290775857 | 0;
      this.F = 1750603025 | 0;
      this.G = 1694076839 | 0;
      this.H = 3204075428 | 0;
      this.outputLen = 28;
    }
  };
  var sha2562 = wrapConstructor(() => new SHA256());
  var sha224 = wrapConstructor(() => new SHA224());

  // node_modules/@noble/hashes/esm/_u64.js
  var U32_MASK64 = BigInt(2 ** 32 - 1);
  var _32n = BigInt(32);
  function fromBig(n, le = false) {
    if (le)
      return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
    return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
  }
  function split(lst, le = false) {
    let Ah = new Uint32Array(lst.length);
    let Al = new Uint32Array(lst.length);
    for (let i = 0; i < lst.length; i++) {
      const { h, l } = fromBig(lst[i], le);
      [Ah[i], Al[i]] = [h, l];
    }
    return [Ah, Al];
  }
  var toBig = (h, l) => BigInt(h >>> 0) << _32n | BigInt(l >>> 0);
  var shrSH = (h, l, s) => h >>> s;
  var shrSL = (h, l, s) => h << 32 - s | l >>> s;
  var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
  var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
  var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
  var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
  var rotr32H = (h, l) => l;
  var rotr32L = (h, l) => h;
  var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
  var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
  var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
  var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
  function add(Ah, Al, Bh, Bl2) {
    const l = (Al >>> 0) + (Bl2 >>> 0);
    return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
  }
  var add3L = (Al, Bl2, Cl) => (Al >>> 0) + (Bl2 >>> 0) + (Cl >>> 0);
  var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
  var add4L = (Al, Bl2, Cl, Dl) => (Al >>> 0) + (Bl2 >>> 0) + (Cl >>> 0) + (Dl >>> 0);
  var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
  var add5L = (Al, Bl2, Cl, Dl, El) => (Al >>> 0) + (Bl2 >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
  var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
  var u64 = {
    fromBig,
    split,
    toBig,
    shrSH,
    shrSL,
    rotrSH,
    rotrSL,
    rotrBH,
    rotrBL,
    rotr32H,
    rotr32L,
    rotlSH,
    rotlSL,
    rotlBH,
    rotlBL,
    add,
    add3L,
    add3H,
    add4L,
    add4H,
    add5H,
    add5L
  };
  var u64_default = u64;

  // node_modules/@noble/hashes/esm/sha512.js
  var [SHA512_Kh, SHA512_Kl] = u64_default.split([
    "0x428a2f98d728ae22",
    "0x7137449123ef65cd",
    "0xb5c0fbcfec4d3b2f",
    "0xe9b5dba58189dbbc",
    "0x3956c25bf348b538",
    "0x59f111f1b605d019",
    "0x923f82a4af194f9b",
    "0xab1c5ed5da6d8118",
    "0xd807aa98a3030242",
    "0x12835b0145706fbe",
    "0x243185be4ee4b28c",
    "0x550c7dc3d5ffb4e2",
    "0x72be5d74f27b896f",
    "0x80deb1fe3b1696b1",
    "0x9bdc06a725c71235",
    "0xc19bf174cf692694",
    "0xe49b69c19ef14ad2",
    "0xefbe4786384f25e3",
    "0x0fc19dc68b8cd5b5",
    "0x240ca1cc77ac9c65",
    "0x2de92c6f592b0275",
    "0x4a7484aa6ea6e483",
    "0x5cb0a9dcbd41fbd4",
    "0x76f988da831153b5",
    "0x983e5152ee66dfab",
    "0xa831c66d2db43210",
    "0xb00327c898fb213f",
    "0xbf597fc7beef0ee4",
    "0xc6e00bf33da88fc2",
    "0xd5a79147930aa725",
    "0x06ca6351e003826f",
    "0x142929670a0e6e70",
    "0x27b70a8546d22ffc",
    "0x2e1b21385c26c926",
    "0x4d2c6dfc5ac42aed",
    "0x53380d139d95b3df",
    "0x650a73548baf63de",
    "0x766a0abb3c77b2a8",
    "0x81c2c92e47edaee6",
    "0x92722c851482353b",
    "0xa2bfe8a14cf10364",
    "0xa81a664bbc423001",
    "0xc24b8b70d0f89791",
    "0xc76c51a30654be30",
    "0xd192e819d6ef5218",
    "0xd69906245565a910",
    "0xf40e35855771202a",
    "0x106aa07032bbd1b8",
    "0x19a4c116b8d2d0c8",
    "0x1e376c085141ab53",
    "0x2748774cdf8eeb99",
    "0x34b0bcb5e19b48a8",
    "0x391c0cb3c5c95a63",
    "0x4ed8aa4ae3418acb",
    "0x5b9cca4f7763e373",
    "0x682e6ff3d6b2b8a3",
    "0x748f82ee5defb2fc",
    "0x78a5636f43172f60",
    "0x84c87814a1f0ab72",
    "0x8cc702081a6439ec",
    "0x90befffa23631e28",
    "0xa4506cebde82bde9",
    "0xbef9a3f7b2c67915",
    "0xc67178f2e372532b",
    "0xca273eceea26619c",
    "0xd186b8c721c0c207",
    "0xeada7dd6cde0eb1e",
    "0xf57d4f7fee6ed178",
    "0x06f067aa72176fba",
    "0x0a637dc5a2c898a6",
    "0x113f9804bef90dae",
    "0x1b710b35131c471b",
    "0x28db77f523047d84",
    "0x32caab7b40c72493",
    "0x3c9ebe0a15c9bebc",
    "0x431d67c49c100d4c",
    "0x4cc5d4becb3e42b6",
    "0x597f299cfc657e2a",
    "0x5fcb6fab3ad6faec",
    "0x6c44198c4a475817"
  ].map((n) => BigInt(n)));
  var SHA512_W_H = new Uint32Array(80);
  var SHA512_W_L = new Uint32Array(80);
  var SHA512 = class extends SHA2 {
    constructor() {
      super(128, 64, 16, false);
      this.Ah = 1779033703 | 0;
      this.Al = 4089235720 | 0;
      this.Bh = 3144134277 | 0;
      this.Bl = 2227873595 | 0;
      this.Ch = 1013904242 | 0;
      this.Cl = 4271175723 | 0;
      this.Dh = 2773480762 | 0;
      this.Dl = 1595750129 | 0;
      this.Eh = 1359893119 | 0;
      this.El = 2917565137 | 0;
      this.Fh = 2600822924 | 0;
      this.Fl = 725511199 | 0;
      this.Gh = 528734635 | 0;
      this.Gl = 4215389547 | 0;
      this.Hh = 1541459225 | 0;
      this.Hl = 327033209 | 0;
    }
    // prettier-ignore
    get() {
      const { Ah, Al, Bh, Bl: Bl2, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      return [Ah, Al, Bh, Bl2, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
    }
    // prettier-ignore
    set(Ah, Al, Bh, Bl2, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
      this.Ah = Ah | 0;
      this.Al = Al | 0;
      this.Bh = Bh | 0;
      this.Bl = Bl2 | 0;
      this.Ch = Ch | 0;
      this.Cl = Cl | 0;
      this.Dh = Dh | 0;
      this.Dl = Dl | 0;
      this.Eh = Eh | 0;
      this.El = El | 0;
      this.Fh = Fh | 0;
      this.Fl = Fl | 0;
      this.Gh = Gh | 0;
      this.Gl = Gl | 0;
      this.Hh = Hh | 0;
      this.Hl = Hl | 0;
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 4) {
        SHA512_W_H[i] = view.getUint32(offset);
        SHA512_W_L[i] = view.getUint32(offset += 4);
      }
      for (let i = 16; i < 80; i++) {
        const W15h = SHA512_W_H[i - 15] | 0;
        const W15l = SHA512_W_L[i - 15] | 0;
        const s0h = u64_default.rotrSH(W15h, W15l, 1) ^ u64_default.rotrSH(W15h, W15l, 8) ^ u64_default.shrSH(W15h, W15l, 7);
        const s0l = u64_default.rotrSL(W15h, W15l, 1) ^ u64_default.rotrSL(W15h, W15l, 8) ^ u64_default.shrSL(W15h, W15l, 7);
        const W2h = SHA512_W_H[i - 2] | 0;
        const W2l = SHA512_W_L[i - 2] | 0;
        const s1h = u64_default.rotrSH(W2h, W2l, 19) ^ u64_default.rotrBH(W2h, W2l, 61) ^ u64_default.shrSH(W2h, W2l, 6);
        const s1l = u64_default.rotrSL(W2h, W2l, 19) ^ u64_default.rotrBL(W2h, W2l, 61) ^ u64_default.shrSL(W2h, W2l, 6);
        const SUMl = u64_default.add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
        const SUMh = u64_default.add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
        SHA512_W_H[i] = SUMh | 0;
        SHA512_W_L[i] = SUMl | 0;
      }
      let { Ah, Al, Bh, Bl: Bl2, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      for (let i = 0; i < 80; i++) {
        const sigma1h = u64_default.rotrSH(Eh, El, 14) ^ u64_default.rotrSH(Eh, El, 18) ^ u64_default.rotrBH(Eh, El, 41);
        const sigma1l = u64_default.rotrSL(Eh, El, 14) ^ u64_default.rotrSL(Eh, El, 18) ^ u64_default.rotrBL(Eh, El, 41);
        const CHIh = Eh & Fh ^ ~Eh & Gh;
        const CHIl = El & Fl ^ ~El & Gl;
        const T1ll = u64_default.add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
        const T1h = u64_default.add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
        const T1l = T1ll | 0;
        const sigma0h = u64_default.rotrSH(Ah, Al, 28) ^ u64_default.rotrBH(Ah, Al, 34) ^ u64_default.rotrBH(Ah, Al, 39);
        const sigma0l = u64_default.rotrSL(Ah, Al, 28) ^ u64_default.rotrBL(Ah, Al, 34) ^ u64_default.rotrBL(Ah, Al, 39);
        const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
        const MAJl = Al & Bl2 ^ Al & Cl ^ Bl2 & Cl;
        Hh = Gh | 0;
        Hl = Gl | 0;
        Gh = Fh | 0;
        Gl = Fl | 0;
        Fh = Eh | 0;
        Fl = El | 0;
        ({ h: Eh, l: El } = u64_default.add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
        Dh = Ch | 0;
        Dl = Cl | 0;
        Ch = Bh | 0;
        Cl = Bl2 | 0;
        Bh = Ah | 0;
        Bl2 = Al | 0;
        const All = u64_default.add3L(T1l, sigma0l, MAJl);
        Ah = u64_default.add3H(All, T1h, sigma0h, MAJh);
        Al = All | 0;
      }
      ({ h: Ah, l: Al } = u64_default.add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
      ({ h: Bh, l: Bl2 } = u64_default.add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl2 | 0));
      ({ h: Ch, l: Cl } = u64_default.add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
      ({ h: Dh, l: Dl } = u64_default.add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
      ({ h: Eh, l: El } = u64_default.add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
      ({ h: Fh, l: Fl } = u64_default.add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
      ({ h: Gh, l: Gl } = u64_default.add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
      ({ h: Hh, l: Hl } = u64_default.add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
      this.set(Ah, Al, Bh, Bl2, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
    }
    roundClean() {
      SHA512_W_H.fill(0);
      SHA512_W_L.fill(0);
    }
    destroy() {
      this.buffer.fill(0);
      this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  };
  var SHA512_224 = class extends SHA512 {
    constructor() {
      super();
      this.Ah = 2352822216 | 0;
      this.Al = 424955298 | 0;
      this.Bh = 1944164710 | 0;
      this.Bl = 2312950998 | 0;
      this.Ch = 502970286 | 0;
      this.Cl = 855612546 | 0;
      this.Dh = 1738396948 | 0;
      this.Dl = 1479516111 | 0;
      this.Eh = 258812777 | 0;
      this.El = 2077511080 | 0;
      this.Fh = 2011393907 | 0;
      this.Fl = 79989058 | 0;
      this.Gh = 1067287976 | 0;
      this.Gl = 1780299464 | 0;
      this.Hh = 286451373 | 0;
      this.Hl = 2446758561 | 0;
      this.outputLen = 28;
    }
  };
  var SHA512_256 = class extends SHA512 {
    constructor() {
      super();
      this.Ah = 573645204 | 0;
      this.Al = 4230739756 | 0;
      this.Bh = 2673172387 | 0;
      this.Bl = 3360449730 | 0;
      this.Ch = 596883563 | 0;
      this.Cl = 1867755857 | 0;
      this.Dh = 2520282905 | 0;
      this.Dl = 1497426621 | 0;
      this.Eh = 2519219938 | 0;
      this.El = 2827943907 | 0;
      this.Fh = 3193839141 | 0;
      this.Fl = 1401305490 | 0;
      this.Gh = 721525244 | 0;
      this.Gl = 746961066 | 0;
      this.Hh = 246885852 | 0;
      this.Hl = 2177182882 | 0;
      this.outputLen = 32;
    }
  };
  var SHA384 = class extends SHA512 {
    constructor() {
      super();
      this.Ah = 3418070365 | 0;
      this.Al = 3238371032 | 0;
      this.Bh = 1654270250 | 0;
      this.Bl = 914150663 | 0;
      this.Ch = 2438529370 | 0;
      this.Cl = 812702999 | 0;
      this.Dh = 355462360 | 0;
      this.Dl = 4144912697 | 0;
      this.Eh = 1731405415 | 0;
      this.El = 4290775857 | 0;
      this.Fh = 2394180231 | 0;
      this.Fl = 1750603025 | 0;
      this.Gh = 3675008525 | 0;
      this.Gl = 1694076839 | 0;
      this.Hh = 1203062813 | 0;
      this.Hl = 3204075428 | 0;
      this.outputLen = 48;
    }
  };
  var sha5122 = wrapConstructor(() => new SHA512());
  var sha512_224 = wrapConstructor(() => new SHA512_224());
  var sha512_256 = wrapConstructor(() => new SHA512_256());
  var sha384 = wrapConstructor(() => new SHA384());

  // node_modules/multihashes-sync/node_modules/multiformats/src/bytes.js
  var empty2 = new Uint8Array(0);

  // node_modules/multihashes-sync/node_modules/multiformats/vendor/varint.js
  var encode_12 = encode8;
  var MSB2 = 128;
  var REST2 = 127;
  var MSBALL2 = ~REST2;
  var INT2 = Math.pow(2, 31);
  function encode8(num, out, offset) {
    out = out || [];
    offset = offset || 0;
    var oldOffset = offset;
    while (num >= INT2) {
      out[offset++] = num & 255 | MSB2;
      num /= 128;
    }
    while (num & MSBALL2) {
      out[offset++] = num & 255 | MSB2;
      num >>>= 7;
    }
    out[offset] = num | 0;
    encode8.bytes = offset - oldOffset + 1;
    return out;
  }
  var decode8 = read2;
  var MSB$12 = 128;
  var REST$12 = 127;
  function read2(buf2, offset) {
    var res = 0, offset = offset || 0, shift = 0, counter = offset, b, l = buf2.length;
    do {
      if (counter >= l) {
        read2.bytes = 0;
        throw new RangeError("Could not decode varint");
      }
      b = buf2[counter++];
      res += shift < 28 ? (b & REST$12) << shift : (b & REST$12) * Math.pow(2, shift);
      shift += 7;
    } while (b >= MSB$12);
    read2.bytes = counter - offset;
    return res;
  }
  var N12 = Math.pow(2, 7);
  var N22 = Math.pow(2, 14);
  var N32 = Math.pow(2, 21);
  var N42 = Math.pow(2, 28);
  var N52 = Math.pow(2, 35);
  var N62 = Math.pow(2, 42);
  var N72 = Math.pow(2, 49);
  var N82 = Math.pow(2, 56);
  var N92 = Math.pow(2, 63);
  var length2 = function(value) {
    return value < N12 ? 1 : value < N22 ? 2 : value < N32 ? 3 : value < N42 ? 4 : value < N52 ? 5 : value < N62 ? 6 : value < N72 ? 7 : value < N82 ? 8 : value < N92 ? 9 : 10;
  };
  var varint2 = {
    encode: encode_12,
    decode: decode8,
    encodingLength: length2
  };
  var _brrp_varint2 = varint2;
  var varint_default2 = _brrp_varint2;

  // node_modules/multihashes-sync/node_modules/multiformats/src/varint.js
  var encodeTo2 = (int, target, offset = 0) => {
    varint_default2.encode(int, target, offset);
    return target;
  };
  var encodingLength2 = (int) => {
    return varint_default2.encodingLength(int);
  };

  // node_modules/multihashes-sync/node_modules/multiformats/src/hashes/digest.js
  var create2 = (code4, digest3) => {
    const size = digest3.byteLength;
    const sizeOffset = encodingLength2(code4);
    const digestOffset = sizeOffset + encodingLength2(size);
    const bytes2 = new Uint8Array(digestOffset + size);
    encodeTo2(code4, bytes2, 0);
    encodeTo2(size, bytes2, sizeOffset);
    bytes2.set(digest3, digestOffset);
    return new Digest2(code4, size, digest3, bytes2);
  };
  var Digest2 = class {
    /**
     * Creates a multihash digest.
     *
     * @param {Code} code
     * @param {Size} size
     * @param {Uint8Array} digest
     * @param {Uint8Array} bytes
     */
    constructor(code4, size, digest3, bytes2) {
      this.code = code4;
      this.size = size;
      this.digest = digest3;
      this.bytes = bytes2;
    }
  };

  // node_modules/multihashes-sync/dist/sync-hasher.js
  var SyncHasher = class {
    constructor(name4, code4, encode14) {
      this.name = name4;
      this.code = code4;
      this.encode = encode14;
    }
    digest(input) {
      const result = this.encode(input);
      return create2(this.code, result);
    }
  };

  // node_modules/multihashes-sync/dist/sha2.browser.js
  var sha2563 = new SyncHasher("sha2-256", 18, (bytes2) => sha2562(bytes2));
  var sha5123 = new SyncHasher("sha2-512", 19, (bytes2) => sha5122(bytes2));

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/vendor/varint.js
  var encode_13 = encode9;
  var MSB3 = 128;
  var REST3 = 127;
  var MSBALL3 = ~REST3;
  var INT3 = Math.pow(2, 31);
  function encode9(num, out, offset) {
    out = out || [];
    offset = offset || 0;
    var oldOffset = offset;
    while (num >= INT3) {
      out[offset++] = num & 255 | MSB3;
      num /= 128;
    }
    while (num & MSBALL3) {
      out[offset++] = num & 255 | MSB3;
      num >>>= 7;
    }
    out[offset] = num | 0;
    encode9.bytes = offset - oldOffset + 1;
    return out;
  }
  var decode10 = read3;
  var MSB$13 = 128;
  var REST$13 = 127;
  function read3(buf2, offset) {
    var res = 0, offset = offset || 0, shift = 0, counter = offset, b, l = buf2.length;
    do {
      if (counter >= l) {
        read3.bytes = 0;
        throw new RangeError("Could not decode varint");
      }
      b = buf2[counter++];
      res += shift < 28 ? (b & REST$13) << shift : (b & REST$13) * Math.pow(2, shift);
      shift += 7;
    } while (b >= MSB$13);
    read3.bytes = counter - offset;
    return res;
  }
  var N13 = Math.pow(2, 7);
  var N23 = Math.pow(2, 14);
  var N33 = Math.pow(2, 21);
  var N43 = Math.pow(2, 28);
  var N53 = Math.pow(2, 35);
  var N63 = Math.pow(2, 42);
  var N73 = Math.pow(2, 49);
  var N83 = Math.pow(2, 56);
  var N93 = Math.pow(2, 63);
  var length3 = function(value) {
    return value < N13 ? 1 : value < N23 ? 2 : value < N33 ? 3 : value < N43 ? 4 : value < N53 ? 5 : value < N63 ? 6 : value < N73 ? 7 : value < N83 ? 8 : value < N93 ? 9 : 10;
  };
  var varint3 = {
    encode: encode_13,
    decode: decode10,
    encodingLength: length3
  };
  var _brrp_varint3 = varint3;
  var varint_default3 = _brrp_varint3;

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/varint.js
  var decode11 = (data, offset = 0) => {
    const code4 = varint_default3.decode(data, offset);
    return [code4, varint_default3.decode.bytes];
  };
  var encodeTo3 = (int, target, offset = 0) => {
    varint_default3.encode(int, target, offset);
    return target;
  };
  var encodingLength3 = (int) => {
    return varint_default3.encodingLength(int);
  };

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bytes.js
  var empty3 = new Uint8Array(0);
  var equals5 = (aa, bb) => {
    if (aa === bb)
      return true;
    if (aa.byteLength !== bb.byteLength) {
      return false;
    }
    for (let ii = 0; ii < aa.byteLength; ii++) {
      if (aa[ii] !== bb[ii]) {
        return false;
      }
    }
    return true;
  };
  var coerce3 = (o) => {
    if (o instanceof Uint8Array && o.constructor.name === "Uint8Array")
      return o;
    if (o instanceof ArrayBuffer)
      return new Uint8Array(o);
    if (ArrayBuffer.isView(o)) {
      return new Uint8Array(o.buffer, o.byteOffset, o.byteLength);
    }
    throw new Error("Unknown type, must be binary type");
  };
  var fromString4 = (str) => new TextEncoder().encode(str);
  var toString4 = (b) => new TextDecoder().decode(b);

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/hashes/digest.js
  var create3 = (code4, digest3) => {
    const size = digest3.byteLength;
    const sizeOffset = encodingLength3(code4);
    const digestOffset = sizeOffset + encodingLength3(size);
    const bytes2 = new Uint8Array(digestOffset + size);
    encodeTo3(code4, bytes2, 0);
    encodeTo3(size, bytes2, sizeOffset);
    bytes2.set(digest3, digestOffset);
    return new Digest3(code4, size, digest3, bytes2);
  };
  var decode12 = (multihash) => {
    const bytes2 = coerce3(multihash);
    const [code4, sizeOffset] = decode11(bytes2);
    const [size, digestOffset] = decode11(bytes2.subarray(sizeOffset));
    const digest3 = bytes2.subarray(sizeOffset + digestOffset);
    if (digest3.byteLength !== size) {
      throw new Error("Incorrect length");
    }
    return new Digest3(code4, size, digest3, bytes2);
  };
  var equals6 = (a, b) => {
    if (a === b) {
      return true;
    } else {
      const data = (
          /** @type {{code?:unknown, size?:unknown, bytes?:unknown}} */
          b
      );
      return a.code === data.code && a.size === data.size && data.bytes instanceof Uint8Array && equals5(a.bytes, data.bytes);
    }
  };
  var Digest3 = class {
    /**
     * Creates a multihash digest.
     *
     * @param {Code} code
     * @param {Size} size
     * @param {Uint8Array} digest
     * @param {Uint8Array} bytes
     */
    constructor(code4, size, digest3, bytes2) {
      this.code = code4;
      this.size = size;
      this.digest = digest3;
      this.bytes = bytes2;
    }
  };

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/base58.js
  var base58_exports2 = {};
  __export(base58_exports2, {
    base58btc: () => base58btc2,
    base58flickr: () => base58flickr2
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/vendor/base-x.js
  function base3(ALPHABET, name4) {
    if (ALPHABET.length >= 255) {
      throw new TypeError("Alphabet too long");
    }
    var BASE_MAP = new Uint8Array(256);
    for (var j = 0; j < BASE_MAP.length; j++) {
      BASE_MAP[j] = 255;
    }
    for (var i = 0; i < ALPHABET.length; i++) {
      var x = ALPHABET.charAt(i);
      var xc = x.charCodeAt(0);
      if (BASE_MAP[xc] !== 255) {
        throw new TypeError(x + " is ambiguous");
      }
      BASE_MAP[xc] = i;
    }
    var BASE = ALPHABET.length;
    var LEADER = ALPHABET.charAt(0);
    var FACTOR = Math.log(BASE) / Math.log(256);
    var iFACTOR = Math.log(256) / Math.log(BASE);
    function encode14(source) {
      if (source instanceof Uint8Array)
        ;
      else if (ArrayBuffer.isView(source)) {
        source = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      } else if (Array.isArray(source)) {
        source = Uint8Array.from(source);
      }
      if (!(source instanceof Uint8Array)) {
        throw new TypeError("Expected Uint8Array");
      }
      if (source.length === 0) {
        return "";
      }
      var zeroes = 0;
      var length4 = 0;
      var pbegin = 0;
      var pend = source.length;
      while (pbegin !== pend && source[pbegin] === 0) {
        pbegin++;
        zeroes++;
      }
      var size = (pend - pbegin) * iFACTOR + 1 >>> 0;
      var b58 = new Uint8Array(size);
      while (pbegin !== pend) {
        var carry = source[pbegin];
        var i2 = 0;
        for (var it1 = size - 1; (carry !== 0 || i2 < length4) && it1 !== -1; it1--, i2++) {
          carry += 256 * b58[it1] >>> 0;
          b58[it1] = carry % BASE >>> 0;
          carry = carry / BASE >>> 0;
        }
        if (carry !== 0) {
          throw new Error("Non-zero carry");
        }
        length4 = i2;
        pbegin++;
      }
      var it2 = size - length4;
      while (it2 !== size && b58[it2] === 0) {
        it2++;
      }
      var str = LEADER.repeat(zeroes);
      for (; it2 < size; ++it2) {
        str += ALPHABET.charAt(b58[it2]);
      }
      return str;
    }
    function decodeUnsafe(source) {
      if (typeof source !== "string") {
        throw new TypeError("Expected String");
      }
      if (source.length === 0) {
        return new Uint8Array();
      }
      var psz = 0;
      if (source[psz] === " ") {
        return;
      }
      var zeroes = 0;
      var length4 = 0;
      while (source[psz] === LEADER) {
        zeroes++;
        psz++;
      }
      var size = (source.length - psz) * FACTOR + 1 >>> 0;
      var b256 = new Uint8Array(size);
      while (source[psz]) {
        var carry = BASE_MAP[source.charCodeAt(psz)];
        if (carry === 255) {
          return;
        }
        var i2 = 0;
        for (var it3 = size - 1; (carry !== 0 || i2 < length4) && it3 !== -1; it3--, i2++) {
          carry += BASE * b256[it3] >>> 0;
          b256[it3] = carry % 256 >>> 0;
          carry = carry / 256 >>> 0;
        }
        if (carry !== 0) {
          throw new Error("Non-zero carry");
        }
        length4 = i2;
        psz++;
      }
      if (source[psz] === " ") {
        return;
      }
      var it4 = size - length4;
      while (it4 !== size && b256[it4] === 0) {
        it4++;
      }
      var vch = new Uint8Array(zeroes + (size - it4));
      var j2 = zeroes;
      while (it4 !== size) {
        vch[j2++] = b256[it4++];
      }
      return vch;
    }
    function decode15(string4) {
      var buffer2 = decodeUnsafe(string4);
      if (buffer2) {
        return buffer2;
      }
      throw new Error(`Non-${name4} character`);
    }
    return {
      encode: encode14,
      decodeUnsafe,
      decode: decode15
    };
  }
  var src2 = base3;
  var _brrp__multiformats_scope_baseX2 = src2;
  var base_x_default2 = _brrp__multiformats_scope_baseX2;

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/base.js
  var Encoder2 = class {
    /**
     * @param {Base} name
     * @param {Prefix} prefix
     * @param {(bytes:Uint8Array) => string} baseEncode
     */
    constructor(name4, prefix, baseEncode) {
      this.name = name4;
      this.prefix = prefix;
      this.baseEncode = baseEncode;
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {API.Multibase<Prefix>}
     */
    encode(bytes2) {
      if (bytes2 instanceof Uint8Array) {
        return `${this.prefix}${this.baseEncode(bytes2)}`;
      } else {
        throw Error("Unknown type, must be binary type");
      }
    }
  };
  var Decoder2 = class {
    /**
     * @param {Base} name
     * @param {Prefix} prefix
     * @param {(text:string) => Uint8Array} baseDecode
     */
    constructor(name4, prefix, baseDecode) {
      this.name = name4;
      this.prefix = prefix;
      if (prefix.codePointAt(0) === void 0) {
        throw new Error("Invalid prefix character");
      }
      this.prefixCodePoint = /** @type {number} */
          prefix.codePointAt(0);
      this.baseDecode = baseDecode;
    }
    /**
     * @param {string} text
     */
    decode(text) {
      if (typeof text === "string") {
        if (text.codePointAt(0) !== this.prefixCodePoint) {
          throw Error(`Unable to decode multibase string ${JSON.stringify(text)}, ${this.name} decoder only supports inputs prefixed with ${this.prefix}`);
        }
        return this.baseDecode(text.slice(this.prefix.length));
      } else {
        throw Error("Can only multibase decode strings");
      }
    }
    /**
     * @template {string} OtherPrefix
     * @param {API.UnibaseDecoder<OtherPrefix>|ComposedDecoder<OtherPrefix>} decoder
     * @returns {ComposedDecoder<Prefix|OtherPrefix>}
     */
    or(decoder) {
      return or2(this, decoder);
    }
  };
  var ComposedDecoder2 = class {
    /**
     * @param {Decoders<Prefix>} decoders
     */
    constructor(decoders) {
      this.decoders = decoders;
    }
    /**
     * @template {string} OtherPrefix
     * @param {API.UnibaseDecoder<OtherPrefix>|ComposedDecoder<OtherPrefix>} decoder
     * @returns {ComposedDecoder<Prefix|OtherPrefix>}
     */
    or(decoder) {
      return or2(this, decoder);
    }
    /**
     * @param {string} input
     * @returns {Uint8Array}
     */
    decode(input) {
      const prefix = (
          /** @type {Prefix} */
          input[0]
      );
      const decoder = this.decoders[prefix];
      if (decoder) {
        return decoder.decode(input);
      } else {
        throw RangeError(`Unable to decode multibase string ${JSON.stringify(input)}, only inputs prefixed with ${Object.keys(this.decoders)} are supported`);
      }
    }
  };
  var or2 = (left, right) => new ComposedDecoder2(
      /** @type {Decoders<L|R>} */
      {
        ...left.decoders || { [
              /** @type API.UnibaseDecoder<L> */
              left.prefix
              ]: left },
        ...right.decoders || { [
              /** @type API.UnibaseDecoder<R> */
              right.prefix
              ]: right }
      }
  );
  var Codec2 = class {
    /**
     * @param {Base} name
     * @param {Prefix} prefix
     * @param {(bytes:Uint8Array) => string} baseEncode
     * @param {(text:string) => Uint8Array} baseDecode
     */
    constructor(name4, prefix, baseEncode, baseDecode) {
      this.name = name4;
      this.prefix = prefix;
      this.baseEncode = baseEncode;
      this.baseDecode = baseDecode;
      this.encoder = new Encoder2(name4, prefix, baseEncode);
      this.decoder = new Decoder2(name4, prefix, baseDecode);
    }
    /**
     * @param {Uint8Array} input
     */
    encode(input) {
      return this.encoder.encode(input);
    }
    /**
     * @param {string} input
     */
    decode(input) {
      return this.decoder.decode(input);
    }
  };
  var from3 = ({ name: name4, prefix, encode: encode14, decode: decode15 }) => new Codec2(name4, prefix, encode14, decode15);
  var baseX2 = ({ prefix, name: name4, alphabet: alphabet3 }) => {
    const { encode: encode14, decode: decode15 } = base_x_default2(alphabet3, name4);
    return from3({
      prefix,
      name: name4,
      encode: encode14,
      /**
       * @param {string} text
       */
      decode: (text) => coerce3(decode15(text))
    });
  };
  var decode13 = (string4, alphabet3, bitsPerChar, name4) => {
    const codes = {};
    for (let i = 0; i < alphabet3.length; ++i) {
      codes[alphabet3[i]] = i;
    }
    let end = string4.length;
    while (string4[end - 1] === "=") {
      --end;
    }
    const out = new Uint8Array(end * bitsPerChar / 8 | 0);
    let bits = 0;
    let buffer2 = 0;
    let written = 0;
    for (let i = 0; i < end; ++i) {
      const value = codes[string4[i]];
      if (value === void 0) {
        throw new SyntaxError(`Non-${name4} character`);
      }
      buffer2 = buffer2 << bitsPerChar | value;
      bits += bitsPerChar;
      if (bits >= 8) {
        bits -= 8;
        out[written++] = 255 & buffer2 >> bits;
      }
    }
    if (bits >= bitsPerChar || 255 & buffer2 << 8 - bits) {
      throw new SyntaxError("Unexpected end of data");
    }
    return out;
  };
  var encode10 = (data, alphabet3, bitsPerChar) => {
    const pad = alphabet3[alphabet3.length - 1] === "=";
    const mask = (1 << bitsPerChar) - 1;
    let out = "";
    let bits = 0;
    let buffer2 = 0;
    for (let i = 0; i < data.length; ++i) {
      buffer2 = buffer2 << 8 | data[i];
      bits += 8;
      while (bits > bitsPerChar) {
        bits -= bitsPerChar;
        out += alphabet3[mask & buffer2 >> bits];
      }
    }
    if (bits) {
      out += alphabet3[mask & buffer2 << bitsPerChar - bits];
    }
    if (pad) {
      while (out.length * bitsPerChar & 7) {
        out += "=";
      }
    }
    return out;
  };
  var rfc46482 = ({ name: name4, prefix, bitsPerChar, alphabet: alphabet3 }) => {
    return from3({
      prefix,
      name: name4,
      encode(input) {
        return encode10(input, alphabet3, bitsPerChar);
      },
      decode(input) {
        return decode13(input, alphabet3, bitsPerChar, name4);
      }
    });
  };

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/base58.js
  var base58btc2 = baseX2({
    name: "base58btc",
    prefix: "z",
    alphabet: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
  });
  var base58flickr2 = baseX2({
    name: "base58flickr",
    prefix: "Z",
    alphabet: "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/base32.js
  var base32_exports2 = {};
  __export(base32_exports2, {
    base32: () => base322,
    base32hex: () => base32hex2,
    base32hexpad: () => base32hexpad2,
    base32hexpadupper: () => base32hexpadupper2,
    base32hexupper: () => base32hexupper2,
    base32pad: () => base32pad2,
    base32padupper: () => base32padupper2,
    base32upper: () => base32upper2,
    base32z: () => base32z2
  });
  var base322 = rfc46482({
    prefix: "b",
    name: "base32",
    alphabet: "abcdefghijklmnopqrstuvwxyz234567",
    bitsPerChar: 5
  });
  var base32upper2 = rfc46482({
    prefix: "B",
    name: "base32upper",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    bitsPerChar: 5
  });
  var base32pad2 = rfc46482({
    prefix: "c",
    name: "base32pad",
    alphabet: "abcdefghijklmnopqrstuvwxyz234567=",
    bitsPerChar: 5
  });
  var base32padupper2 = rfc46482({
    prefix: "C",
    name: "base32padupper",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567=",
    bitsPerChar: 5
  });
  var base32hex2 = rfc46482({
    prefix: "v",
    name: "base32hex",
    alphabet: "0123456789abcdefghijklmnopqrstuv",
    bitsPerChar: 5
  });
  var base32hexupper2 = rfc46482({
    prefix: "V",
    name: "base32hexupper",
    alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUV",
    bitsPerChar: 5
  });
  var base32hexpad2 = rfc46482({
    prefix: "t",
    name: "base32hexpad",
    alphabet: "0123456789abcdefghijklmnopqrstuv=",
    bitsPerChar: 5
  });
  var base32hexpadupper2 = rfc46482({
    prefix: "T",
    name: "base32hexpadupper",
    alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUV=",
    bitsPerChar: 5
  });
  var base32z2 = rfc46482({
    prefix: "h",
    name: "base32z",
    alphabet: "ybndrfg8ejkmcpqxot1uwisza345h769",
    bitsPerChar: 5
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/cid.js
  var format = (link, base4) => {
    const { bytes: bytes2, version: version2 } = link;
    switch (version2) {
      case 0:
        return toStringV02(
            bytes2,
            baseCache(link),
            /** @type {API.MultibaseEncoder<"z">} */
            base4 || base58btc2.encoder
        );
      default:
        return toStringV12(
            bytes2,
            baseCache(link),
            /** @type {API.MultibaseEncoder<Prefix>} */
            base4 || base322.encoder
        );
    }
  };
  var cache = /* @__PURE__ */ new WeakMap();
  var baseCache = (cid) => {
    const baseCache2 = cache.get(cid);
    if (baseCache2 == null) {
      const baseCache3 = /* @__PURE__ */ new Map();
      cache.set(cid, baseCache3);
      return baseCache3;
    }
    return baseCache2;
  };
  var CID2 = class {
    /**
     * @param {Version} version - Version of the CID
     * @param {Format} code - Code of the codec content is encoded in, see https://github.com/multiformats/multicodec/blob/master/table.csv
     * @param {API.MultihashDigest<Alg>} multihash - (Multi)hash of the of the content.
     * @param {Uint8Array} bytes
     *
     */
    constructor(version2, code4, multihash, bytes2) {
      this.code = code4;
      this.version = version2;
      this.multihash = multihash;
      this.bytes = bytes2;
      this["/"] = bytes2;
    }
    /**
     * Signalling `cid.asCID === cid` has been replaced with `cid['/'] === cid.bytes`
     * please either use `CID.asCID(cid)` or switch to new signalling mechanism
     *
     * @deprecated
     */
    get asCID() {
      return this;
    }
    // ArrayBufferView
    get byteOffset() {
      return this.bytes.byteOffset;
    }
    // ArrayBufferView
    get byteLength() {
      return this.bytes.byteLength;
    }
    /**
     * @returns {CID<Data, API.DAG_PB, API.SHA_256, 0>}
     */
    toV0() {
      switch (this.version) {
        case 0: {
          return (
              /** @type {CID<Data, API.DAG_PB, API.SHA_256, 0>} */
              this
          );
        }
        case 1: {
          const { code: code4, multihash } = this;
          if (code4 !== DAG_PB_CODE2) {
            throw new Error("Cannot convert a non dag-pb CID to CIDv0");
          }
          if (multihash.code !== SHA_256_CODE2) {
            throw new Error("Cannot convert non sha2-256 multihash CID to CIDv0");
          }
          return (
              /** @type {CID<Data, API.DAG_PB, API.SHA_256, 0>} */
              CID2.createV0(
                  /** @type {API.MultihashDigest<API.SHA_256>} */
                  multihash
              )
          );
        }
        default: {
          throw Error(
              `Can not convert CID version ${this.version} to version 0. This is a bug please report`
          );
        }
      }
    }
    /**
     * @returns {CID<Data, Format, Alg, 1>}
     */
    toV1() {
      switch (this.version) {
        case 0: {
          const { code: code4, digest: digest3 } = this.multihash;
          const multihash = create3(code4, digest3);
          return (
              /** @type {CID<Data, Format, Alg, 1>} */
              CID2.createV1(this.code, multihash)
          );
        }
        case 1: {
          return (
              /** @type {CID<Data, Format, Alg, 1>} */
              this
          );
        }
        default: {
          throw Error(
              `Can not convert CID version ${this.version} to version 1. This is a bug please report`
          );
        }
      }
    }
    /**
     * @param {unknown} other
     * @returns {other is CID<Data, Format, Alg, Version>}
     */
    equals(other) {
      return CID2.equals(this, other);
    }
    /**
     * @template {unknown} Data
     * @template {number} Format
     * @template {number} Alg
     * @template {API.Version} Version
     * @param {API.Link<Data, Format, Alg, Version>} self
     * @param {unknown} other
     * @returns {other is CID}
     */
    static equals(self2, other) {
      const unknown2 = (
          /** @type {{code?:unknown, version?:unknown, multihash?:unknown}} */
          other
      );
      return unknown2 && self2.code === unknown2.code && self2.version === unknown2.version && equals6(self2.multihash, unknown2.multihash);
    }
    /**
     * @param {API.MultibaseEncoder<string>} [base]
     * @returns {string}
     */
    toString(base4) {
      return format(this, base4);
    }
    toJSON() {
      return { "/": format(this) };
    }
    link() {
      return this;
    }
    get [Symbol.toStringTag]() {
      return "CID";
    }
    // Legacy
    [Symbol.for("nodejs.util.inspect.custom")]() {
      return `CID(${this.toString()})`;
    }
    /**
     * Takes any input `value` and returns a `CID` instance if it was
     * a `CID` otherwise returns `null`. If `value` is instanceof `CID`
     * it will return value back. If `value` is not instance of this CID
     * class, but is compatible CID it will return new instance of this
     * `CID` class. Otherwise returns null.
     *
     * This allows two different incompatible versions of CID library to
     * co-exist and interop as long as binary interface is compatible.
     *
     * @template {unknown} Data
     * @template {number} Format
     * @template {number} Alg
     * @template {API.Version} Version
     * @template {unknown} U
     * @param {API.Link<Data, Format, Alg, Version>|U} input
     * @returns {CID<Data, Format, Alg, Version>|null}
     */
    static asCID(input) {
      if (input == null) {
        return null;
      }
      const value = (
          /** @type {any} */
          input
      );
      if (value instanceof CID2) {
        return value;
      } else if (value["/"] != null && value["/"] === value.bytes || value.asCID === value) {
        const { version: version2, code: code4, multihash, bytes: bytes2 } = value;
        return new CID2(
            version2,
            code4,
            /** @type {API.MultihashDigest<Alg>} */
            multihash,
            bytes2 || encodeCID2(version2, code4, multihash.bytes)
        );
      } else if (value[cidSymbol2] === true) {
        const { version: version2, multihash, code: code4 } = value;
        const digest3 = (
            /** @type {API.MultihashDigest<Alg>} */
            decode12(multihash)
        );
        return CID2.create(version2, code4, digest3);
      } else {
        return null;
      }
    }
    /**
     *
     * @template {unknown} Data
     * @template {number} Format
     * @template {number} Alg
     * @template {API.Version} Version
     * @param {Version} version - Version of the CID
     * @param {Format} code - Code of the codec content is encoded in, see https://github.com/multiformats/multicodec/blob/master/table.csv
     * @param {API.MultihashDigest<Alg>} digest - (Multi)hash of the of the content.
     * @returns {CID<Data, Format, Alg, Version>}
     */
    static create(version2, code4, digest3) {
      if (typeof code4 !== "number") {
        throw new Error("String codecs are no longer supported");
      }
      if (!(digest3.bytes instanceof Uint8Array)) {
        throw new Error("Invalid digest");
      }
      switch (version2) {
        case 0: {
          if (code4 !== DAG_PB_CODE2) {
            throw new Error(
                `Version 0 CID must use dag-pb (code: ${DAG_PB_CODE2}) block encoding`
            );
          } else {
            return new CID2(version2, code4, digest3, digest3.bytes);
          }
        }
        case 1: {
          const bytes2 = encodeCID2(version2, code4, digest3.bytes);
          return new CID2(version2, code4, digest3, bytes2);
        }
        default: {
          throw new Error("Invalid version");
        }
      }
    }
    /**
     * Simplified version of `create` for CIDv0.
     *
     * @template {unknown} [T=unknown]
     * @param {API.MultihashDigest<typeof SHA_256_CODE>} digest - Multihash.
     * @returns {CID<T, typeof DAG_PB_CODE, typeof SHA_256_CODE, 0>}
     */
    static createV0(digest3) {
      return CID2.create(0, DAG_PB_CODE2, digest3);
    }
    /**
     * Simplified version of `create` for CIDv1.
     *
     * @template {unknown} Data
     * @template {number} Code
     * @template {number} Alg
     * @param {Code} code - Content encoding format code.
     * @param {API.MultihashDigest<Alg>} digest - Miltihash of the content.
     * @returns {CID<Data, Code, Alg, 1>}
     */
    static createV1(code4, digest3) {
      return CID2.create(1, code4, digest3);
    }
    /**
     * Decoded a CID from its binary representation. The byte array must contain
     * only the CID with no additional bytes.
     *
     * An error will be thrown if the bytes provided do not contain a valid
     * binary representation of a CID.
     *
     * @template {unknown} Data
     * @template {number} Code
     * @template {number} Alg
     * @template {API.Version} Ver
     * @param {API.ByteView<API.Link<Data, Code, Alg, Ver>>} bytes
     * @returns {CID<Data, Code, Alg, Ver>}
     */
    static decode(bytes2) {
      const [cid, remainder] = CID2.decodeFirst(bytes2);
      if (remainder.length) {
        throw new Error("Incorrect length");
      }
      return cid;
    }
    /**
     * Decoded a CID from its binary representation at the beginning of a byte
     * array.
     *
     * Returns an array with the first element containing the CID and the second
     * element containing the remainder of the original byte array. The remainder
     * will be a zero-length byte array if the provided bytes only contained a
     * binary CID representation.
     *
     * @template {unknown} T
     * @template {number} C
     * @template {number} A
     * @template {API.Version} V
     * @param {API.ByteView<API.Link<T, C, A, V>>} bytes
     * @returns {[CID<T, C, A, V>, Uint8Array]}
     */
    static decodeFirst(bytes2) {
      const specs = CID2.inspectBytes(bytes2);
      const prefixSize = specs.size - specs.multihashSize;
      const multihashBytes = coerce3(
          bytes2.subarray(prefixSize, prefixSize + specs.multihashSize)
      );
      if (multihashBytes.byteLength !== specs.multihashSize) {
        throw new Error("Incorrect length");
      }
      const digestBytes = multihashBytes.subarray(
          specs.multihashSize - specs.digestSize
      );
      const digest3 = new Digest3(
          specs.multihashCode,
          specs.digestSize,
          digestBytes,
          multihashBytes
      );
      const cid = specs.version === 0 ? CID2.createV0(
          /** @type {API.MultihashDigest<API.SHA_256>} */
          digest3
      ) : CID2.createV1(specs.codec, digest3);
      return [
        /** @type {CID<T, C, A, V>} */
        cid,
        bytes2.subarray(specs.size)
      ];
    }
    /**
     * Inspect the initial bytes of a CID to determine its properties.
     *
     * Involves decoding up to 4 varints. Typically this will require only 4 to 6
     * bytes but for larger multicodec code values and larger multihash digest
     * lengths these varints can be quite large. It is recommended that at least
     * 10 bytes be made available in the `initialBytes` argument for a complete
     * inspection.
     *
     * @template {unknown} T
     * @template {number} C
     * @template {number} A
     * @template {API.Version} V
     * @param {API.ByteView<API.Link<T, C, A, V>>} initialBytes
     * @returns {{ version:V, codec:C, multihashCode:A, digestSize:number, multihashSize:number, size:number }}
     */
    static inspectBytes(initialBytes) {
      let offset = 0;
      const next = () => {
        const [i, length4] = decode11(initialBytes.subarray(offset));
        offset += length4;
        return i;
      };
      let version2 = (
          /** @type {V} */
          next()
      );
      let codec = (
          /** @type {C} */
          DAG_PB_CODE2
      );
      if (
          /** @type {number} */
          version2 === 18
      ) {
        version2 = /** @type {V} */
            0;
        offset = 0;
      } else {
        codec = /** @type {C} */
            next();
      }
      if (version2 !== 0 && version2 !== 1) {
        throw new RangeError(`Invalid CID version ${version2}`);
      }
      const prefixSize = offset;
      const multihashCode = (
          /** @type {A} */
          next()
      );
      const digestSize = next();
      const size = offset + digestSize;
      const multihashSize = size - prefixSize;
      return { version: version2, codec, multihashCode, digestSize, multihashSize, size };
    }
    /**
     * Takes cid in a string representation and creates an instance. If `base`
     * decoder is not provided will use a default from the configuration. It will
     * throw an error if encoding of the CID is not compatible with supplied (or
     * a default decoder).
     *
     * @template {string} Prefix
     * @template {unknown} Data
     * @template {number} Code
     * @template {number} Alg
     * @template {API.Version} Ver
     * @param {API.ToString<API.Link<Data, Code, Alg, Ver>, Prefix>} source
     * @param {API.MultibaseDecoder<Prefix>} [base]
     * @returns {CID<Data, Code, Alg, Ver>}
     */
    static parse(source, base4) {
      const [prefix, bytes2] = parseCIDtoBytes2(source, base4);
      const cid = CID2.decode(bytes2);
      if (cid.version === 0 && source[0] !== "Q") {
        throw Error("Version 0 CID string must not include multibase prefix");
      }
      baseCache(cid).set(prefix, source);
      return cid;
    }
  };
  var parseCIDtoBytes2 = (source, base4) => {
    switch (source[0]) {
      case "Q": {
        const decoder = base4 || base58btc2;
        return [
          /** @type {Prefix} */
          base58btc2.prefix,
          decoder.decode(`${base58btc2.prefix}${source}`)
        ];
      }
      case base58btc2.prefix: {
        const decoder = base4 || base58btc2;
        return [
          /** @type {Prefix} */
          base58btc2.prefix,
          decoder.decode(source)
        ];
      }
      case base322.prefix: {
        const decoder = base4 || base322;
        return [
          /** @type {Prefix} */
          base322.prefix,
          decoder.decode(source)
        ];
      }
      default: {
        if (base4 == null) {
          throw Error(
              "To parse non base32 or base58btc encoded CID multibase decoder must be provided"
          );
        }
        return [
          /** @type {Prefix} */
          source[0],
          base4.decode(source)
        ];
      }
    }
  };
  var toStringV02 = (bytes2, cache2, base4) => {
    const { prefix } = base4;
    if (prefix !== base58btc2.prefix) {
      throw Error(`Cannot string encode V0 in ${base4.name} encoding`);
    }
    const cid = cache2.get(prefix);
    if (cid == null) {
      const cid2 = base4.encode(bytes2).slice(1);
      cache2.set(prefix, cid2);
      return cid2;
    } else {
      return cid;
    }
  };
  var toStringV12 = (bytes2, cache2, base4) => {
    const { prefix } = base4;
    const cid = cache2.get(prefix);
    if (cid == null) {
      const cid2 = base4.encode(bytes2);
      cache2.set(prefix, cid2);
      return cid2;
    } else {
      return cid;
    }
  };
  var DAG_PB_CODE2 = 112;
  var SHA_256_CODE2 = 18;
  var encodeCID2 = (version2, code4, multihash) => {
    const codeOffset = encodingLength3(version2);
    const hashOffset = codeOffset + encodingLength3(code4);
    const bytes2 = new Uint8Array(hashOffset + multihash.byteLength);
    encodeTo3(version2, bytes2, 0);
    encodeTo3(code4, bytes2, codeOffset);
    bytes2.set(multihash, hashOffset);
    return bytes2;
  };
  var cidSymbol2 = Symbol.for("@ipld/js-cid/CID");

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/base36.js
  var base36_exports2 = {};
  __export(base36_exports2, {
    base36: () => base362,
    base36upper: () => base36upper2
  });
  var base362 = baseX2({
    prefix: "k",
    name: "base36",
    alphabet: "0123456789abcdefghijklmnopqrstuvwxyz"
  });
  var base36upper2 = baseX2({
    prefix: "K",
    name: "base36upper",
    alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  });

  // node_modules/@ceramicnetwork/streamid/lib/stream-type.js
  var registry = {
    tile: 0,
    "caip10-link": 1,
    model: 2,
    MID: 3,
    UNLOADABLE: 4
  };
  function codeByName(name4) {
    const index = registry[name4];
    if (typeof index !== "undefined") {
      return index;
    } else {
      throw new Error(`No stream type registered for name ${name4}`);
    }
  }
  function nameByCode(index) {
    const pair = Object.entries(registry).find(([, v]) => v === index);
    if (pair) {
      return pair[0];
    } else {
      throw new Error(`No stream type registered for index ${index}`);
    }
  }
  var StreamType = class {
  };
  StreamType.nameByCode = nameByCode;
  StreamType.codeByName = codeByName;

  // node_modules/@ceramicnetwork/streamid/lib/commit-id.js
  var import_varint6 = __toESM(require_varint(), 1);

  // node_modules/@ceramicnetwork/streamid/node_modules/uint8arrays/dist/src/util/as-uint8array.js
  function asUint8Array2(buf2) {
    if (globalThis.Buffer != null) {
      return new Uint8Array(buf2.buffer, buf2.byteOffset, buf2.byteLength);
    }
    return buf2;
  }

  // node_modules/@ceramicnetwork/streamid/node_modules/uint8arrays/dist/src/alloc.js
  function allocUnsafe2(size = 0) {
    if (globalThis.Buffer?.allocUnsafe != null) {
      return asUint8Array2(globalThis.Buffer.allocUnsafe(size));
    }
    return new Uint8Array(size);
  }

  // node_modules/@ceramicnetwork/streamid/node_modules/uint8arrays/dist/src/concat.js
  function concat3(arrays, length4) {
    if (length4 == null) {
      length4 = arrays.reduce((acc, curr) => acc + curr.length, 0);
    }
    const output2 = allocUnsafe2(length4);
    let offset = 0;
    for (const arr of arrays) {
      output2.set(arr, offset);
      offset += arr.length;
    }
    return asUint8Array2(output2);
  }

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/identity.js
  var identity_exports3 = {};
  __export(identity_exports3, {
    identity: () => identity3
  });
  var identity3 = from3({
    prefix: "\0",
    name: "identity",
    encode: (buf2) => toString4(buf2),
    decode: (str) => fromString4(str)
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/base2.js
  var base2_exports2 = {};
  __export(base2_exports2, {
    base2: () => base22
  });
  var base22 = rfc46482({
    prefix: "0",
    name: "base2",
    alphabet: "01",
    bitsPerChar: 1
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/base8.js
  var base8_exports2 = {};
  __export(base8_exports2, {
    base8: () => base82
  });
  var base82 = rfc46482({
    prefix: "7",
    name: "base8",
    alphabet: "01234567",
    bitsPerChar: 3
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/base10.js
  var base10_exports2 = {};
  __export(base10_exports2, {
    base10: () => base102
  });
  var base102 = baseX2({
    prefix: "9",
    name: "base10",
    alphabet: "0123456789"
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/base16.js
  var base16_exports2 = {};
  __export(base16_exports2, {
    base16: () => base162,
    base16upper: () => base16upper2
  });
  var base162 = rfc46482({
    prefix: "f",
    name: "base16",
    alphabet: "0123456789abcdef",
    bitsPerChar: 4
  });
  var base16upper2 = rfc46482({
    prefix: "F",
    name: "base16upper",
    alphabet: "0123456789ABCDEF",
    bitsPerChar: 4
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/base64.js
  var base64_exports2 = {};
  __export(base64_exports2, {
    base64: () => base642,
    base64pad: () => base64pad2,
    base64url: () => base64url2,
    base64urlpad: () => base64urlpad2
  });
  var base642 = rfc46482({
    prefix: "m",
    name: "base64",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    bitsPerChar: 6
  });
  var base64pad2 = rfc46482({
    prefix: "M",
    name: "base64pad",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    bitsPerChar: 6
  });
  var base64url2 = rfc46482({
    prefix: "u",
    name: "base64url",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
    bitsPerChar: 6
  });
  var base64urlpad2 = rfc46482({
    prefix: "U",
    name: "base64urlpad",
    alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=",
    bitsPerChar: 6
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/bases/base256emoji.js
  var base256emoji_exports2 = {};
  __export(base256emoji_exports2, {
    base256emoji: () => base256emoji2
  });
  var alphabet2 = Array.from("\u{1F680}\u{1FA90}\u2604\u{1F6F0}\u{1F30C}\u{1F311}\u{1F312}\u{1F313}\u{1F314}\u{1F315}\u{1F316}\u{1F317}\u{1F318}\u{1F30D}\u{1F30F}\u{1F30E}\u{1F409}\u2600\u{1F4BB}\u{1F5A5}\u{1F4BE}\u{1F4BF}\u{1F602}\u2764\u{1F60D}\u{1F923}\u{1F60A}\u{1F64F}\u{1F495}\u{1F62D}\u{1F618}\u{1F44D}\u{1F605}\u{1F44F}\u{1F601}\u{1F525}\u{1F970}\u{1F494}\u{1F496}\u{1F499}\u{1F622}\u{1F914}\u{1F606}\u{1F644}\u{1F4AA}\u{1F609}\u263A\u{1F44C}\u{1F917}\u{1F49C}\u{1F614}\u{1F60E}\u{1F607}\u{1F339}\u{1F926}\u{1F389}\u{1F49E}\u270C\u2728\u{1F937}\u{1F631}\u{1F60C}\u{1F338}\u{1F64C}\u{1F60B}\u{1F497}\u{1F49A}\u{1F60F}\u{1F49B}\u{1F642}\u{1F493}\u{1F929}\u{1F604}\u{1F600}\u{1F5A4}\u{1F603}\u{1F4AF}\u{1F648}\u{1F447}\u{1F3B6}\u{1F612}\u{1F92D}\u2763\u{1F61C}\u{1F48B}\u{1F440}\u{1F62A}\u{1F611}\u{1F4A5}\u{1F64B}\u{1F61E}\u{1F629}\u{1F621}\u{1F92A}\u{1F44A}\u{1F973}\u{1F625}\u{1F924}\u{1F449}\u{1F483}\u{1F633}\u270B\u{1F61A}\u{1F61D}\u{1F634}\u{1F31F}\u{1F62C}\u{1F643}\u{1F340}\u{1F337}\u{1F63B}\u{1F613}\u2B50\u2705\u{1F97A}\u{1F308}\u{1F608}\u{1F918}\u{1F4A6}\u2714\u{1F623}\u{1F3C3}\u{1F490}\u2639\u{1F38A}\u{1F498}\u{1F620}\u261D\u{1F615}\u{1F33A}\u{1F382}\u{1F33B}\u{1F610}\u{1F595}\u{1F49D}\u{1F64A}\u{1F639}\u{1F5E3}\u{1F4AB}\u{1F480}\u{1F451}\u{1F3B5}\u{1F91E}\u{1F61B}\u{1F534}\u{1F624}\u{1F33C}\u{1F62B}\u26BD\u{1F919}\u2615\u{1F3C6}\u{1F92B}\u{1F448}\u{1F62E}\u{1F646}\u{1F37B}\u{1F343}\u{1F436}\u{1F481}\u{1F632}\u{1F33F}\u{1F9E1}\u{1F381}\u26A1\u{1F31E}\u{1F388}\u274C\u270A\u{1F44B}\u{1F630}\u{1F928}\u{1F636}\u{1F91D}\u{1F6B6}\u{1F4B0}\u{1F353}\u{1F4A2}\u{1F91F}\u{1F641}\u{1F6A8}\u{1F4A8}\u{1F92C}\u2708\u{1F380}\u{1F37A}\u{1F913}\u{1F619}\u{1F49F}\u{1F331}\u{1F616}\u{1F476}\u{1F974}\u25B6\u27A1\u2753\u{1F48E}\u{1F4B8}\u2B07\u{1F628}\u{1F31A}\u{1F98B}\u{1F637}\u{1F57A}\u26A0\u{1F645}\u{1F61F}\u{1F635}\u{1F44E}\u{1F932}\u{1F920}\u{1F927}\u{1F4CC}\u{1F535}\u{1F485}\u{1F9D0}\u{1F43E}\u{1F352}\u{1F617}\u{1F911}\u{1F30A}\u{1F92F}\u{1F437}\u260E\u{1F4A7}\u{1F62F}\u{1F486}\u{1F446}\u{1F3A4}\u{1F647}\u{1F351}\u2744\u{1F334}\u{1F4A3}\u{1F438}\u{1F48C}\u{1F4CD}\u{1F940}\u{1F922}\u{1F445}\u{1F4A1}\u{1F4A9}\u{1F450}\u{1F4F8}\u{1F47B}\u{1F910}\u{1F92E}\u{1F3BC}\u{1F975}\u{1F6A9}\u{1F34E}\u{1F34A}\u{1F47C}\u{1F48D}\u{1F4E3}\u{1F942}");
  var alphabetBytesToChars2 = (
      /** @type {string[]} */
      alphabet2.reduce(
          (p, c, i) => {
            p[i] = c;
            return p;
          },
          /** @type {string[]} */
          []
      )
  );
  var alphabetCharsToBytes2 = (
      /** @type {number[]} */
      alphabet2.reduce(
          (p, c, i) => {
            p[
                /** @type {number} */
                c.codePointAt(0)
                ] = i;
            return p;
          },
          /** @type {number[]} */
          []
      )
  );
  function encode11(data) {
    return data.reduce((p, c) => {
      p += alphabetBytesToChars2[c];
      return p;
    }, "");
  }
  function decode14(str) {
    const byts = [];
    for (const char of str) {
      const byt = alphabetCharsToBytes2[
          /** @type {number} */
          char.codePointAt(0)
          ];
      if (byt === void 0) {
        throw new Error(`Non-base256emoji character: ${char}`);
      }
      byts.push(byt);
    }
    return new Uint8Array(byts);
  }
  var base256emoji2 = from3({
    prefix: "\u{1F680}",
    name: "base256emoji",
    encode: encode11,
    decode: decode14
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/hashes/sha2-browser.js
  var sha2_browser_exports2 = {};
  __export(sha2_browser_exports2, {
    sha256: () => sha2564,
    sha512: () => sha5124
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/hashes/hasher.js
  var from4 = ({ name: name4, code: code4, encode: encode14 }) => new Hasher2(name4, code4, encode14);
  var Hasher2 = class {
    /**
     *
     * @param {Name} name
     * @param {Code} code
     * @param {(input: Uint8Array) => Await<Uint8Array>} encode
     */
    constructor(name4, code4, encode14) {
      this.name = name4;
      this.code = code4;
      this.encode = encode14;
    }
    /**
     * @param {Uint8Array} input
     * @returns {Await<Digest.Digest<Code, number>>}
     */
    digest(input) {
      if (input instanceof Uint8Array) {
        const result = this.encode(input);
        return result instanceof Uint8Array ? create3(this.code, result) : result.then((digest3) => create3(this.code, digest3));
      } else {
        throw Error("Unknown type, must be binary type");
      }
    }
  };

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/hashes/sha2-browser.js
  var sha2 = (name4) => (
      /**
       * @param {Uint8Array} data
       */
      async (data) => new Uint8Array(await crypto.subtle.digest(name4, data))
  );
  var sha2564 = from4({
    name: "sha2-256",
    code: 18,
    encode: sha2("SHA-256")
  });
  var sha5124 = from4({
    name: "sha2-512",
    code: 19,
    encode: sha2("SHA-512")
  });

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/hashes/identity.js
  var identity_exports4 = {};
  __export(identity_exports4, {
    identity: () => identity4
  });
  var code3 = 0;
  var name3 = "identity";
  var encode12 = coerce3;
  var digest2 = (input) => create3(code3, encode12(input));
  var identity4 = { code: code3, name: name3, encode: encode12, digest: digest2 };

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/codecs/json.js
  var textEncoder3 = new TextEncoder();
  var textDecoder3 = new TextDecoder();

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/basics.js
  var bases2 = { ...identity_exports3, ...base2_exports2, ...base8_exports2, ...base10_exports2, ...base16_exports2, ...base32_exports2, ...base36_exports2, ...base58_exports2, ...base64_exports2, ...base256emoji_exports2 };
  var hashes2 = { ...sha2_browser_exports2, ...identity_exports4 };

  // node_modules/@ceramicnetwork/streamid/node_modules/uint8arrays/dist/src/util/bases.js
  function createCodec2(name4, prefix, encode14, decode15) {
    return {
      name: name4,
      prefix,
      encoder: {
        name: name4,
        prefix,
        encode: encode14
      },
      decoder: {
        decode: decode15
      }
    };
  }
  var string2 = createCodec2("utf8", "u", (buf2) => {
    const decoder = new TextDecoder("utf8");
    return "u" + decoder.decode(buf2);
  }, (str) => {
    const encoder = new TextEncoder();
    return encoder.encode(str.substring(1));
  });
  var ascii2 = createCodec2("ascii", "a", (buf2) => {
    let string4 = "a";
    for (let i = 0; i < buf2.length; i++) {
      string4 += String.fromCharCode(buf2[i]);
    }
    return string4;
  }, (str) => {
    str = str.substring(1);
    const buf2 = allocUnsafe2(str.length);
    for (let i = 0; i < str.length; i++) {
      buf2[i] = str.charCodeAt(i);
    }
    return buf2;
  });
  var BASES2 = {
    utf8: string2,
    "utf-8": string2,
    hex: bases2.base16,
    latin1: ascii2,
    ascii: ascii2,
    binary: ascii2,
    ...bases2
  };

  // node_modules/mapmoize/dist/ancillary.js
  var Strategy;
  (function(Strategy2) {
    Strategy2["WEAKMAP"] = "weakmap";
    Strategy2["REPLACE"] = "replace";
  })(Strategy || (Strategy = {}));

  // node_modules/mapmoize/dist/getter.js
  function isGetterDescriptor(input) {
    return Boolean(input.get);
  }
  function memoizeGetter(descriptor, propertyKey, strategy) {
    const originalFunction = descriptor.get;
    switch (strategy) {
      case Strategy.WEAKMAP: {
        const bindings = /* @__PURE__ */ new WeakMap();
        descriptor.get = function() {
          let memoized = bindings.get(this);
          if (!memoized) {
            memoized = originalFunction.apply(this);
            bindings.set(this, memoized);
          }
          return memoized;
        };
        break;
      }
      case Strategy.REPLACE: {
        descriptor.get = function() {
          const value = originalFunction.apply(this);
          Object.defineProperty(this, propertyKey, {
            configurable: false,
            enumerable: false,
            value
          });
          return value;
        };
        break;
      }
      default:
        throw new Error(`Unsupported strategy: ${strategy}`);
    }
  }

  // node_modules/mapmoize/dist/method.js
  function isMethodDescriptor(input) {
    return Boolean(input.value);
  }
  function memoizeMethod(descriptor, propertyKey, strategy, hashFunction, argsCacheBuilder) {
    const originalMethod = descriptor.value;
    switch (originalMethod.length) {
      case 0: {
        switch (strategy) {
          case Strategy.REPLACE: {
            descriptor.value = function() {
              const calculated = originalMethod.apply(this);
              Object.defineProperty(this, propertyKey, {
                enumerable: descriptor.enumerable,
                configurable: descriptor.configurable,
                writable: descriptor.writable,
                value: function() {
                  return calculated;
                }
              });
            };
            return;
          }
          case Strategy.WEAKMAP: {
            const bindingsCache = /* @__PURE__ */ new WeakMap();
            descriptor.value = function() {
              if (bindingsCache.has(this)) {
                return bindingsCache.get(this);
              }
              let calculated = originalMethod.apply(this);
              bindingsCache.set(this, calculated);
              return calculated;
            };
            break;
          }
        }
        break;
      }
      case 1: {
        switch (strategy) {
          case Strategy.WEAKMAP: {
            const bindingsCache = /* @__PURE__ */ new WeakMap();
            descriptor.value = function(arg) {
              let argsCache = bindingsCache.get(this);
              if (!argsCache) {
                argsCache = argsCacheBuilder();
                bindingsCache.set(this, argsCache);
              }
              if (argsCache.has(arg)) {
                return argsCache.get(arg);
              }
              const memoized = originalMethod.call(this, arg);
              argsCache.set(arg, memoized);
              return memoized;
            };
            break;
          }
          case Strategy.REPLACE: {
            descriptor.value = function(arg) {
              const memoizationContainer = argsCacheBuilder();
              function replacement(arg2) {
                if (memoizationContainer.has(arg2)) {
                  return memoizationContainer.get(arg2);
                } else {
                  const memoized = originalMethod.call(this, arg2);
                  memoizationContainer.set(arg2, memoized);
                  return memoized;
                }
              }
              Object.defineProperty(this, propertyKey, {
                configurable: descriptor.configurable,
                enumerable: descriptor.enumerable,
                writable: descriptor.writable,
                value: replacement
              });
              return replacement.call(this, arg);
            };
            break;
          }
        }
        break;
      }
      default: {
        switch (strategy) {
          case Strategy.REPLACE: {
            descriptor.value = function(...args) {
              const memoizationContainer = argsCacheBuilder();
              function replacement(...args2) {
                const digest3 = hashFunction.apply(this, args2);
                if (memoizationContainer.has(digest3)) {
                  return memoizationContainer.get(digest3);
                } else {
                  const memoized = originalMethod.apply(this, args2);
                  memoizationContainer.set(digest3, memoized);
                  return memoized;
                }
              }
              Object.defineProperty(this, propertyKey, {
                configurable: descriptor.configurable,
                enumerable: descriptor.enumerable,
                writable: descriptor.writable,
                value: replacement
              });
              return replacement.apply(this, args);
            };
            break;
          }
          case Strategy.WEAKMAP: {
            const bindingsCache = /* @__PURE__ */ new WeakMap();
            descriptor.value = function replacement(...args) {
              let argsCache = bindingsCache.get(this);
              const digest3 = hashFunction.apply(this, args);
              if (argsCache?.has(digest3)) {
                return argsCache.get(digest3);
              }
              if (!argsCache) {
                argsCache = argsCacheBuilder();
                bindingsCache.set(this, argsCache);
              }
              const memoized = originalMethod.apply(this, args);
              argsCache.set(digest3, memoized);
              return memoized;
            };
          }
        }
      }
    }
  }

  // node_modules/mapmoize/dist/index.js
  function defaultDigest(...args) {
    let result = "";
    for (let i = 0, length4 = args.length; i < length4; i++) {
      result += `${args[i]}$!$`;
    }
    return result;
  }
  function memoize(params) {
    const hashFunction = params?.hashFunction || defaultDigest;
    const strategy = params?.strategy || Strategy.WEAKMAP;
    const argsCacheBuilder = params?.argsCacheBuilder || (() => /* @__PURE__ */ new Map());
    return (target, propertyKey, descriptor) => {
      if (isMethodDescriptor(descriptor)) {
        memoizeMethod(descriptor, propertyKey, strategy, hashFunction, argsCacheBuilder);
        return;
      }
      if (isGetterDescriptor(descriptor)) {
        memoizeGetter(descriptor, propertyKey, strategy);
        return;
      }
      throw new Error("Decorate only a method or get accessor");
    };
  }
  var Memoize = memoize;

  // node_modules/@ceramicnetwork/streamid/lib/constants.js
  var STREAMID_CODEC = 206;

  // node_modules/@ceramicnetwork/streamid/node_modules/multiformats/src/block.js
  function readonly3({ enumerable = true, configurable = false } = {}) {
    return { enumerable, configurable, writable: false };
  }
  function* linksWithin(path, value) {
    if (value != null && typeof value === "object") {
      if (Array.isArray(value)) {
        for (const [index, element] of value.entries()) {
          const elementPath = [...path, index];
          const cid = CID2.asCID(element);
          if (cid) {
            yield [elementPath.join("/"), cid];
          } else if (typeof element === "object") {
            yield* links2(element, elementPath);
          }
        }
      } else {
        const cid = CID2.asCID(value);
        if (cid) {
          yield [path.join("/"), cid];
        } else {
          yield* links2(value, path);
        }
      }
    }
  }
  function* links2(source, base4) {
    if (source == null || source instanceof Uint8Array) {
      return;
    }
    const cid = CID2.asCID(source);
    if (cid) {
      yield [base4.join("/"), cid];
    }
    for (const [key, value] of Object.entries(source)) {
      const path = (
          /** @type {[string|number, string]} */
          [...base4, key]
      );
      yield* linksWithin(path, value);
    }
  }
  function* treeWithin(path, value) {
    if (Array.isArray(value)) {
      for (const [index, element] of value.entries()) {
        const elementPath = [...path, index];
        yield elementPath.join("/");
        if (typeof element === "object" && !CID2.asCID(element)) {
          yield* tree2(element, elementPath);
        }
      }
    } else {
      yield* tree2(value, path);
    }
  }
  function* tree2(source, base4) {
    if (source == null || typeof source !== "object") {
      return;
    }
    for (const [key, value] of Object.entries(source)) {
      const path = (
          /** @type {[string|number, string]} */
          [...base4, key]
      );
      yield path.join("/");
      if (value != null && !(value instanceof Uint8Array) && typeof value === "object" && !CID2.asCID(value)) {
        yield* treeWithin(path, value);
      }
    }
  }
  function get2(source, path) {
    let node = (
        /** @type {Record<string, any>} */
        source
    );
    for (const [index, key] of path.entries()) {
      node = node[key];
      if (node == null) {
        throw new Error(`Object has no property at ${path.slice(0, index + 1).map((part) => `[${JSON.stringify(part)}]`).join("")}`);
      }
      const cid = CID2.asCID(node);
      if (cid) {
        return { value: cid, remaining: path.slice(index + 1).join("/") };
      }
    }
    return { value: node };
  }
  var Block2 = class {
    /**
     * @param {object} options
     * @param {CID<T, C, A, V>} options.cid
     * @param {API.ByteView<T>} options.bytes
     * @param {T} options.value
     */
    constructor({ cid, bytes: bytes2, value }) {
      if (!cid || !bytes2 || typeof value === "undefined") {
        throw new Error("Missing required argument");
      }
      this.cid = cid;
      this.bytes = bytes2;
      this.value = value;
      this.asBlock = this;
      Object.defineProperties(this, {
        cid: readonly3(),
        bytes: readonly3(),
        value: readonly3(),
        asBlock: readonly3()
      });
    }
    links() {
      return links2(this.value, []);
    }
    tree() {
      return tree2(this.value, []);
    }
    /**
     *
     * @param {string} [path]
     * @returns {API.BlockCursorView<unknown>}
     */
    get(path = "/") {
      return get2(this.value, path.split("/").filter(Boolean));
    }
  };
  async function encode13({ value, codec, hasher }) {
    if (typeof value === "undefined")
      throw new Error('Missing required argument "value"');
    if (!codec || !hasher)
      throw new Error("Missing required argument: codec or hasher");
    const bytes2 = codec.encode(value);
    const hash3 = await hasher.digest(bytes2);
    const cid = CID2.create(
        1,
        codec.code,
        hash3
    );
    return new Block2({ value, bytes: bytes2, cid });
  }

  // node_modules/@ceramicnetwork/streamid/lib/stream-id.js
  var import_varint5 = __toESM(require_varint(), 1);

  // node_modules/@ceramicnetwork/streamid/lib/try-catch.util.js
  function tryCatch(fn) {
    try {
      return fn();
    } catch (e) {
      return e;
    }
  }

  // node_modules/@ceramicnetwork/streamid/lib/reading-bytes.js
  var import_varint4 = __toESM(require_varint(), 1);
  function readVarint(bytes2) {
    const value = import_varint4.default.decode(bytes2);
    const readLength = import_varint4.default.decode.bytes;
    const remainder = bytes2.subarray(readLength);
    return [value, remainder, readLength];
  }
  function isCidVersion(input) {
    return input === 0 || input === 1;
  }
  function readCid(bytes2) {
    const [cidVersion, cidVersionRemainder] = readVarint(bytes2);
    if (!isCidVersion(cidVersion)) {
      throw new Error(`Unknown CID version ${cidVersion}`);
    }
    const [codec, codecRemainder] = readVarint(cidVersionRemainder);
    const [, mhCodecRemainder, mhCodecLength] = readVarint(codecRemainder);
    const [mhLength, , mhLengthLength] = readVarint(mhCodecRemainder);
    const multihashBytes = codecRemainder.subarray(0, mhCodecLength + mhLengthLength + mhLength);
    const multihashBytesRemainder = codecRemainder.subarray(mhCodecLength + mhLengthLength + mhLength);
    return [CID2.create(cidVersion, codec, decode12(multihashBytes)), multihashBytesRemainder];
  }

  // node_modules/@ceramicnetwork/streamid/lib/stream-ref-parsing.js
  function fromBytes(input, title = "StreamRef") {
    const [streamCodec, streamCodecRemainder] = readVarint(input);
    if (streamCodec !== STREAMID_CODEC)
      throw new Error(`Invalid ${title}, does not include streamid codec`);
    const [type, streamtypeRemainder] = readVarint(streamCodecRemainder);
    const cidResult = readCid(streamtypeRemainder);
    const [genesis, genesisRemainder] = cidResult;
    if (genesisRemainder.length === 0) {
      return {
        kind: "stream-id",
        type,
        genesis
      };
    } else if (genesisRemainder.length === 1 && genesisRemainder[0] === 0) {
      return {
        kind: "commit-id",
        type,
        genesis,
        commit: null
      };
    } else {
      const [commit] = readCid(genesisRemainder);
      return {
        kind: "commit-id",
        type,
        genesis,
        commit
      };
    }
  }
  var URL_PATTERN = /(ceramic:\/\/|\/ceramic\/)?([a-zA-Z0-9]+)(\?commit=([a-zA-Z0-9]+))?/;
  function fromString6(input, title = "StreamRef") {
    const protocolMatch = URL_PATTERN.exec(input) || [];
    const base4 = protocolMatch[2];
    if (!base4)
      throw new Error(`Malformed ${title} string: ${input}`);
    const bytes2 = base362.decode(base4);
    const streamRef = fromBytes(bytes2);
    const commit = protocolMatch[4];
    if (commit) {
      return {
        kind: "commit-id",
        type: streamRef.type,
        genesis: streamRef.genesis,
        commit: parseCommit(streamRef.genesis, commit)
      };
    }
    return streamRef;
  }
  function parseCID(input) {
    try {
      return typeof input === "string" ? CID2.parse(input) : CID2.asCID(input);
    } catch {
      return null;
    }
  }
  function parseCommit(genesis, commit = null) {
    if (!commit)
      return null;
    if (commit === "0")
      return null;
    const commitCID = parseCID(commit);
    if (commitCID) {
      if (genesis.equals(commitCID)) {
        return null;
      } else {
        return commitCID;
      }
    } else {
      throw new Error("Cannot specify commit as a number except to request commit 0 (the genesis commit)");
    }
  }

  // node_modules/@ceramicnetwork/streamid/lib/stream-id.js
  var __decorate = function(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function")
      r = Reflect.decorate(decorators, target, key, desc);
    else
      for (var i = decorators.length - 1; i >= 0; i--)
        if (d = decorators[i])
          r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
  };
  var __metadata = function(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function")
      return Reflect.metadata(k, v);
  };
  var InvalidStreamIDBytesError = class extends Error {
    constructor(bytes2) {
      super(`Invalid StreamID bytes ${base362.encode(bytes2)}: contains commit`);
    }
  };
  var InvalidStreamIDStringError = class extends Error {
    constructor(input) {
      super(`Invalid StreamID string ${input}: contains commit`);
    }
  };
  function fromBytes2(bytes2) {
    const parsed = fromBytes(bytes2, "StreamID");
    if (parsed.kind === "stream-id") {
      return new StreamID(parsed.type, parsed.genesis);
    }
    throw new InvalidStreamIDBytesError(bytes2);
  }
  function fromBytesNoThrow(bytes2) {
    return tryCatch(() => fromBytes2(bytes2));
  }
  function fromString7(input) {
    const parsed = fromString6(input, "StreamID");
    if (parsed.kind === "stream-id") {
      return new StreamID(parsed.type, parsed.genesis);
    }
    throw new InvalidStreamIDStringError(input);
  }
  function fromStringNoThrow(input) {
    return tryCatch(() => fromString7(input));
  }
  var TAG = Symbol.for("@ceramicnetwork/streamid/StreamID");
  var StreamID = class {
    constructor(type, cid) {
      this._tag = TAG;
      if (!(type || type === 0))
        throw new Error("StreamID constructor: type required");
      if (!cid)
        throw new Error("StreamID constructor: cid required");
      this._type = typeof type === "string" ? StreamType.codeByName(type) : type;
      this._cid = typeof cid === "string" ? CID2.parse(cid) : cid;
    }
    static isInstance(instance) {
      return typeof instance === "object" && "_tag" in instance && instance._tag === TAG;
    }
    static async fromGenesis(type, genesis) {
      const block = await encode13({ value: genesis, codec: esm_exports, hasher: sha2564 });
      return new StreamID(type, block.cid);
    }
    get type() {
      return this._type;
    }
    get typeName() {
      return StreamType.nameByCode(this._type);
    }
    get cid() {
      return this._cid;
    }
    get bytes() {
      const codec = import_varint5.default.encode(STREAMID_CODEC);
      const type = import_varint5.default.encode(this.type);
      return concat3([codec, type, this.cid.bytes]);
    }
    get baseID() {
      return new StreamID(this._type, this._cid);
    }
    equals(other) {
      if (StreamID.isInstance(other)) {
        return this.type === other.type && this.cid.equals(other.cid);
      } else {
        return false;
      }
    }
    toString() {
      return base362.encode(this.bytes);
    }
    toUrl() {
      return `ceramic://${this.toString()}`;
    }
    [Symbol.for("nodejs.util.inspect.custom")]() {
      return `StreamID(${this.toString()})`;
    }
    [Symbol.toPrimitive]() {
      return this.toString();
    }
  };
  StreamID.fromBytes = fromBytes2;
  StreamID.fromBytesNoThrow = fromBytesNoThrow;
  StreamID.fromString = fromString7;
  StreamID.fromStringNoThrow = fromStringNoThrow;
  __decorate([
    Memoize(),
    __metadata("design:type", String),
    __metadata("design:paramtypes", [])
  ], StreamID.prototype, "typeName", null);
  __decorate([
    Memoize(),
    __metadata("design:type", Uint8Array),
    __metadata("design:paramtypes", [])
  ], StreamID.prototype, "bytes", null);
  __decorate([
    Memoize(),
    __metadata("design:type", StreamID),
    __metadata("design:paramtypes", [])
  ], StreamID.prototype, "baseID", null);
  __decorate([
    Memoize(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", String)
  ], StreamID.prototype, "toString", null);
  __decorate([
    Memoize(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", String)
  ], StreamID.prototype, "toUrl", null);

  // node_modules/@ceramicnetwork/streamid/lib/commit-id.js
  var __decorate2 = function(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function")
      r = Reflect.decorate(decorators, target, key, desc);
    else
      for (var i = decorators.length - 1; i >= 0; i--)
        if (d = decorators[i])
          r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
  };
  var __metadata2 = function(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function")
      return Reflect.metadata(k, v);
  };
  var __classPrivateFieldSet = function(receiver, state, value, kind, f) {
    if (kind === "m")
      throw new TypeError("Private method is not writable");
    if (kind === "a" && !f)
      throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
      throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
  };
  var __classPrivateFieldGet = function(receiver, state, kind, f) {
    if (kind === "a" && !f)
      throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
      throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
  };
  var _CommitID_type;
  var _CommitID_cid;
  var _CommitID_commit;
  var InvalidCommitIDBytesError = class extends Error {
    constructor(bytes2) {
      super(`Error while parsing CommitID from bytes ${base362.encode(bytes2)}: no commit information provided`);
    }
  };
  var InvalidCommitIDStringError = class extends Error {
    constructor(input) {
      super(`Error while parsing CommitID from string ${input}: no commit information provided`);
    }
  };
  function fromBytes3(bytes2) {
    const parsed = fromBytes(bytes2, "CommitID");
    if (parsed.kind === "commit-id") {
      return new CommitID(parsed.type, parsed.genesis, parsed.commit);
    }
    throw new InvalidCommitIDBytesError(bytes2);
  }
  function fromBytesNoThrow2(bytes2) {
    return tryCatch(() => fromBytes3(bytes2));
  }
  function fromString8(input) {
    const parsed = fromString6(input, "CommitID");
    if (parsed.kind === "commit-id") {
      return new CommitID(parsed.type, parsed.genesis, parsed.commit);
    }
    throw new InvalidCommitIDStringError(input);
  }
  function fromStringNoThrow2(input) {
    return tryCatch(() => fromString8(input));
  }
  var TAG2 = Symbol.for("@ceramicnetwork/streamid/CommitID");
  function make(stream, commit) {
    return new CommitID(stream.type, stream.cid, commit);
  }
  var CommitID = class {
    constructor(type, cid, commit = null) {
      this._tag = TAG2;
      _CommitID_type.set(this, void 0);
      _CommitID_cid.set(this, void 0);
      _CommitID_commit.set(this, void 0);
      if (!type && type !== 0)
        throw new Error("constructor: type required");
      if (!cid)
        throw new Error("constructor: cid required");
      __classPrivateFieldSet(this, _CommitID_type, typeof type === "string" ? StreamType.codeByName(type) : type, "f");
      __classPrivateFieldSet(this, _CommitID_cid, typeof cid === "string" ? CID2.parse(cid) : cid, "f");
      __classPrivateFieldSet(this, _CommitID_commit, parseCommit(__classPrivateFieldGet(this, _CommitID_cid, "f"), commit), "f");
    }
    static isInstance(instance) {
      return typeof instance === "object" && "_tag" in instance && instance._tag === TAG2;
    }
    get baseID() {
      return new StreamID(__classPrivateFieldGet(this, _CommitID_type, "f"), __classPrivateFieldGet(this, _CommitID_cid, "f"));
    }
    get type() {
      return __classPrivateFieldGet(this, _CommitID_type, "f");
    }
    get typeName() {
      return StreamType.nameByCode(__classPrivateFieldGet(this, _CommitID_type, "f"));
    }
    get cid() {
      return __classPrivateFieldGet(this, _CommitID_cid, "f");
    }
    get commit() {
      return __classPrivateFieldGet(this, _CommitID_commit, "f") || __classPrivateFieldGet(this, _CommitID_cid, "f");
    }
    get bytes() {
      const codec = import_varint6.default.encode(STREAMID_CODEC);
      const type = import_varint6.default.encode(this.type);
      const commitBytes = __classPrivateFieldGet(this, _CommitID_commit, "f")?.bytes || new Uint8Array([0]);
      return concat3([codec, type, this.cid.bytes, commitBytes]);
    }
    equals(other) {
      return this.type === other.type && this.cid.equals(other.cid) && this.commit.equals(other.commit);
    }
    toString() {
      return base362.encode(this.bytes);
    }
    toUrl() {
      return `ceramic://${this.toString()}`;
    }
    [(_CommitID_type = /* @__PURE__ */ new WeakMap(), _CommitID_cid = /* @__PURE__ */ new WeakMap(), _CommitID_commit = /* @__PURE__ */ new WeakMap(), Symbol.for("nodejs.util.inspect.custom"))]() {
      return `CommitID(${this.toString()})`;
    }
    [Symbol.toPrimitive]() {
      return this.toString();
    }
  };
  CommitID.fromBytes = fromBytes3;
  CommitID.fromBytesNoThrow = fromBytesNoThrow2;
  CommitID.fromString = fromString8;
  CommitID.fromStringNoThrow = fromStringNoThrow2;
  CommitID.make = make;
  __decorate2([
    Memoize(),
    __metadata2("design:type", StreamID),
    __metadata2("design:paramtypes", [])
  ], CommitID.prototype, "baseID", null);
  __decorate2([
    Memoize(),
    __metadata2("design:type", String),
    __metadata2("design:paramtypes", [])
  ], CommitID.prototype, "typeName", null);
  __decorate2([
    Memoize(),
    __metadata2("design:type", CID2),
    __metadata2("design:paramtypes", [])
  ], CommitID.prototype, "commit", null);
  __decorate2([
    Memoize(),
    __metadata2("design:type", Uint8Array),
    __metadata2("design:paramtypes", [])
  ], CommitID.prototype, "bytes", null);
  __decorate2([
    Memoize(),
    __metadata2("design:type", Function),
    __metadata2("design:paramtypes", []),
    __metadata2("design:returntype", String)
  ], CommitID.prototype, "toString", null);
  __decorate2([
    Memoize(),
    __metadata2("design:type", Function),
    __metadata2("design:paramtypes", []),
    __metadata2("design:returntype", String)
  ], CommitID.prototype, "toUrl", null);

  // lit_actions/src/utils.ts
  var ec = new import_elliptic.default.ec("secp256k1");
  var toStableObject = (obj) => {
    return JSON.parse((0, import_fast_json_stable_stringify.default)(obj));
  };
  function sha256Hash(payload) {
    const data = typeof payload === "string" ? fromString2(payload) : payload;
    return (0, import_sha2562.hash)(data);
  }
  var bytesToBase64url = (b) => {
    return toString2(b, "base64url");
  };
  var encodeBase64url = (s) => {
    return bytesToBase64url(fromString2(s));
  };
  var encodeSection = (data) => {
    return encodeBase64url(JSON.stringify(data));
  };
  var decodeLinkedBlock = (linkedBlock2) => {
    const linkedBlockArray = fromString2(linkedBlock2, "base64pad");
    return decode7(linkedBlockArray);
  };
  var getCID = async (payload) => {
    const linkedBlockEncoded = await encode7({
      value: payload,
      codec: esm_exports,
      hasher: sha2563
    });
    return toString2(linkedBlockEncoded.cid.bytes, "base64url");
  };
  var getToSign = async (did2, payload) => {
    const protectedHeader = {};
    const kid = `${did2}#${did2.split(":")[2]}`;
    const header = toStableObject(Object.assign(protectedHeader, { kid, alg: "ES256K" }));
    const encodedPayload = typeof payload === "string" ? payload : encodeSection(payload);
    const signingInput = [encodeSection(header), encodedPayload].join(".");
    return Array.from(sha256Hash(signingInput));
  };
  var decodeDIDWithLit = (encodedDID) => {
    if (!encodedDID)
      throw new Error("Invalid argument: encodedDID is missing.");
    const arr = encodedDID.split(":");
    if (arr[0] !== "did")
      throw new Error('Invalid format: string should start with "did:"');
    if (arr[1] !== "key")
      throw new Error('Invalid format: string should start with "did:key"');
    if (arr[2].charAt(0) !== "z")
      throw new Error('Invalid format: string should start with "did:key:z"');
    const str = arr[2].substring(1);
    const bytes2 = fromString2(str, "base58btc");
    const originalBytes = new Uint8Array(bytes2.length - 2);
    bytes2.forEach((_, i) => {
      originalBytes[i] = bytes2[i + 2];
    });
    const pubPoint = ec.keyFromPublic(originalBytes).getPublic();
    const pubKey = pubPoint.encode("hex", false);
    return `0x${pubKey}`;
  };
  var arrayEquals = (a, b) => {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((val, index) => val === b[index]);
  };
  var getStreamID = (modelObj) => {
    return StreamID.fromBytes(new Uint8Array(Object.values(modelObj))).toString();
  };

  // node_modules/yup/index.esm.js
  var import_property_expr = __toESM(require_property_expr());
  var import_tiny_case = __toESM(require_tiny_case());
  var import_toposort = __toESM(require_toposort());
  var toString6 = Object.prototype.toString;
  var errorToString = Error.prototype.toString;
  var regExpToString = RegExp.prototype.toString;
  var symbolToString = typeof Symbol !== "undefined" ? Symbol.prototype.toString : () => "";
  var SYMBOL_REGEXP = /^Symbol\((.*)\)(.*)$/;
  function printNumber(val) {
    if (val != +val)
      return "NaN";
    const isNegativeZero = val === 0 && 1 / val < 0;
    return isNegativeZero ? "-0" : "" + val;
  }
  function printSimpleValue(val, quoteStrings = false) {
    if (val == null || val === true || val === false)
      return "" + val;
    const typeOf = typeof val;
    if (typeOf === "number")
      return printNumber(val);
    if (typeOf === "string")
      return quoteStrings ? `"${val}"` : val;
    if (typeOf === "function")
      return "[Function " + (val.name || "anonymous") + "]";
    if (typeOf === "symbol")
      return symbolToString.call(val).replace(SYMBOL_REGEXP, "Symbol($1)");
    const tag = toString6.call(val).slice(8, -1);
    if (tag === "Date")
      return isNaN(val.getTime()) ? "" + val : val.toISOString(val);
    if (tag === "Error" || val instanceof Error)
      return "[" + errorToString.call(val) + "]";
    if (tag === "RegExp")
      return regExpToString.call(val);
    return null;
  }
  function printValue(value, quoteStrings) {
    let result = printSimpleValue(value, quoteStrings);
    if (result !== null)
      return result;
    return JSON.stringify(value, function(key, value2) {
      let result2 = printSimpleValue(this[key], quoteStrings);
      if (result2 !== null)
        return result2;
      return value2;
    }, 2);
  }
  function toArray(value) {
    return value == null ? [] : [].concat(value);
  }
  var strReg = /\$\{\s*(\w+)\s*\}/g;
  var ValidationError = class extends Error {
    static formatError(message, params) {
      const path = params.label || params.path || "this";
      if (path !== params.path)
        params = Object.assign({}, params, {
          path
        });
      if (typeof message === "string")
        return message.replace(strReg, (_, key) => printValue(params[key]));
      if (typeof message === "function")
        return message(params);
      return message;
    }
    static isError(err) {
      return err && err.name === "ValidationError";
    }
    constructor(errorOrErrors, value, field, type) {
      super();
      this.value = void 0;
      this.path = void 0;
      this.type = void 0;
      this.errors = void 0;
      this.params = void 0;
      this.inner = void 0;
      this.name = "ValidationError";
      this.value = value;
      this.path = field;
      this.type = type;
      this.errors = [];
      this.inner = [];
      toArray(errorOrErrors).forEach((err) => {
        if (ValidationError.isError(err)) {
          this.errors.push(...err.errors);
          this.inner = this.inner.concat(err.inner.length ? err.inner : err);
        } else {
          this.errors.push(err);
        }
      });
      this.message = this.errors.length > 1 ? `${this.errors.length} errors occurred` : this.errors[0];
      if (Error.captureStackTrace)
        Error.captureStackTrace(this, ValidationError);
    }
  };
  var mixed = {
    default: "${path} is invalid",
    required: "${path} is a required field",
    defined: "${path} must be defined",
    notNull: "${path} cannot be null",
    oneOf: "${path} must be one of the following values: ${values}",
    notOneOf: "${path} must not be one of the following values: ${values}",
    notType: ({
                path,
                type,
                value,
                originalValue
              }) => {
      const castMsg = originalValue != null && originalValue !== value ? ` (cast from the value \`${printValue(originalValue, true)}\`).` : ".";
      return type !== "mixed" ? `${path} must be a \`${type}\` type, but the final value was: \`${printValue(value, true)}\`` + castMsg : `${path} must match the configured type. The validated value was: \`${printValue(value, true)}\`` + castMsg;
    }
  };
  var string3 = {
    length: "${path} must be exactly ${length} characters",
    min: "${path} must be at least ${min} characters",
    max: "${path} must be at most ${max} characters",
    matches: '${path} must match the following: "${regex}"',
    email: "${path} must be a valid email",
    url: "${path} must be a valid URL",
    uuid: "${path} must be a valid UUID",
    trim: "${path} must be a trimmed string",
    lowercase: "${path} must be a lowercase string",
    uppercase: "${path} must be a upper case string"
  };
  var number2 = {
    min: "${path} must be greater than or equal to ${min}",
    max: "${path} must be less than or equal to ${max}",
    lessThan: "${path} must be less than ${less}",
    moreThan: "${path} must be greater than ${more}",
    positive: "${path} must be a positive number",
    negative: "${path} must be a negative number",
    integer: "${path} must be an integer"
  };
  var date = {
    min: "${path} field must be later than ${min}",
    max: "${path} field must be at earlier than ${max}"
  };
  var boolean = {
    isValue: "${path} field must be ${value}"
  };
  var object = {
    noUnknown: "${path} field has unspecified keys: ${unknown}"
  };
  var array = {
    min: "${path} field must have at least ${min} items",
    max: "${path} field must have less than or equal to ${max} items",
    length: "${path} must have ${length} items"
  };
  var tuple = {
    notType: (params) => {
      const {
        path,
        value,
        spec
      } = params;
      const typeLen = spec.types.length;
      if (Array.isArray(value)) {
        if (value.length < typeLen)
          return `${path} tuple value has too few items, expected a length of ${typeLen} but got ${value.length} for value: \`${printValue(value, true)}\``;
        if (value.length > typeLen)
          return `${path} tuple value has too many items, expected a length of ${typeLen} but got ${value.length} for value: \`${printValue(value, true)}\``;
      }
      return ValidationError.formatError(mixed.notType, params);
    }
  };
  var locale = Object.assign(/* @__PURE__ */ Object.create(null), {
    mixed,
    string: string3,
    number: number2,
    date,
    object,
    array,
    boolean
  });
  var isSchema = (obj) => obj && obj.__isYupSchema__;
  var Condition = class {
    static fromOptions(refs, config) {
      if (!config.then && !config.otherwise)
        throw new TypeError("either `then:` or `otherwise:` is required for `when()` conditions");
      let {
        is: is2,
        then,
        otherwise
      } = config;
      let check = typeof is2 === "function" ? is2 : (...values) => values.every((value) => value === is2);
      return new Condition(refs, (values, schema) => {
        var _branch;
        let branch = check(...values) ? then : otherwise;
        return (_branch = branch == null ? void 0 : branch(schema)) != null ? _branch : schema;
      });
    }
    constructor(refs, builder) {
      this.fn = void 0;
      this.refs = refs;
      this.refs = refs;
      this.fn = builder;
    }
    resolve(base4, options) {
      let values = this.refs.map((ref) => (
          // TODO: ? operator here?
          ref.getValue(options == null ? void 0 : options.value, options == null ? void 0 : options.parent, options == null ? void 0 : options.context)
      ));
      let schema = this.fn(values, base4, options);
      if (schema === void 0 || // @ts-ignore this can be base
          schema === base4) {
        return base4;
      }
      if (!isSchema(schema))
        throw new TypeError("conditions must return a schema object");
      return schema.resolve(options);
    }
  };
  var prefixes = {
    context: "$",
    value: "."
  };
  var Reference = class {
    constructor(key, options = {}) {
      this.key = void 0;
      this.isContext = void 0;
      this.isValue = void 0;
      this.isSibling = void 0;
      this.path = void 0;
      this.getter = void 0;
      this.map = void 0;
      if (typeof key !== "string")
        throw new TypeError("ref must be a string, got: " + key);
      this.key = key.trim();
      if (key === "")
        throw new TypeError("ref must be a non-empty string");
      this.isContext = this.key[0] === prefixes.context;
      this.isValue = this.key[0] === prefixes.value;
      this.isSibling = !this.isContext && !this.isValue;
      let prefix = this.isContext ? prefixes.context : this.isValue ? prefixes.value : "";
      this.path = this.key.slice(prefix.length);
      this.getter = this.path && (0, import_property_expr.getter)(this.path, true);
      this.map = options.map;
    }
    getValue(value, parent, context) {
      let result = this.isContext ? context : this.isValue ? value : parent;
      if (this.getter)
        result = this.getter(result || {});
      if (this.map)
        result = this.map(result);
      return result;
    }
    /**
     *
     * @param {*} value
     * @param {Object} options
     * @param {Object=} options.context
     * @param {Object=} options.parent
     */
    cast(value, options) {
      return this.getValue(value, options == null ? void 0 : options.parent, options == null ? void 0 : options.context);
    }
    resolve() {
      return this;
    }
    describe() {
      return {
        type: "ref",
        key: this.key
      };
    }
    toString() {
      return `Ref(${this.key})`;
    }
    static isRef(value) {
      return value && value.__isYupRef;
    }
  };
  Reference.prototype.__isYupRef = true;
  var isAbsent = (value) => value == null;
  function createValidation(config) {
    function validate({
                        value,
                        path = "",
                        options,
                        originalValue,
                        schema
                      }, panic, next) {
      const {
        name: name4,
        test,
        params,
        message,
        skipAbsent
      } = config;
      let {
        parent,
        context,
        abortEarly = schema.spec.abortEarly
      } = options;
      function resolve(item) {
        return Reference.isRef(item) ? item.getValue(value, parent, context) : item;
      }
      function createError(overrides = {}) {
        const nextParams = Object.assign({
          value,
          originalValue,
          label: schema.spec.label,
          path: overrides.path || path,
          spec: schema.spec
        }, params, overrides.params);
        for (const key of Object.keys(nextParams))
          nextParams[key] = resolve(nextParams[key]);
        const error = new ValidationError(ValidationError.formatError(overrides.message || message, nextParams), value, nextParams.path, overrides.type || name4);
        error.params = nextParams;
        return error;
      }
      const invalid = abortEarly ? panic : next;
      let ctx = {
        path,
        parent,
        type: name4,
        from: options.from,
        createError,
        resolve,
        options,
        originalValue,
        schema
      };
      const handleResult = (validOrError) => {
        if (ValidationError.isError(validOrError))
          invalid(validOrError);
        else if (!validOrError)
          invalid(createError());
        else
          next(null);
      };
      const handleError = (err) => {
        if (ValidationError.isError(err))
          invalid(err);
        else
          panic(err);
      };
      const shouldSkip = skipAbsent && isAbsent(value);
      if (!options.sync) {
        try {
          Promise.resolve(!shouldSkip ? test.call(ctx, value, ctx) : true).then(handleResult, handleError);
        } catch (err) {
          handleError(err);
        }
        return;
      }
      let result;
      try {
        var _result;
        result = !shouldSkip ? test.call(ctx, value, ctx) : true;
        if (typeof ((_result = result) == null ? void 0 : _result.then) === "function") {
          throw new Error(`Validation test of type: "${ctx.type}" returned a Promise during a synchronous validate. This test will finish after the validate call has returned`);
        }
      } catch (err) {
        handleError(err);
        return;
      }
      handleResult(result);
    }
    validate.OPTIONS = config;
    return validate;
  }
  function getIn(schema, path, value, context = value) {
    let parent, lastPart, lastPartDebug;
    if (!path)
      return {
        parent,
        parentPath: path,
        schema
      };
    (0, import_property_expr.forEach)(path, (_part, isBracket, isArray) => {
      let part = isBracket ? _part.slice(1, _part.length - 1) : _part;
      schema = schema.resolve({
        context,
        parent,
        value
      });
      let isTuple = schema.type === "tuple";
      let idx = isArray ? parseInt(part, 10) : 0;
      if (schema.innerType || isTuple) {
        if (isTuple && !isArray)
          throw new Error(`Yup.reach cannot implicitly index into a tuple type. the path part "${lastPartDebug}" must contain an index to the tuple element, e.g. "${lastPartDebug}[0]"`);
        if (value && idx >= value.length) {
          throw new Error(`Yup.reach cannot resolve an array item at index: ${_part}, in the path: ${path}. because there is no value at that index. `);
        }
        parent = value;
        value = value && value[idx];
        schema = isTuple ? schema.spec.types[idx] : schema.innerType;
      }
      if (!isArray) {
        if (!schema.fields || !schema.fields[part])
          throw new Error(`The schema does not contain the path: ${path}. (failed at: ${lastPartDebug} which is a type: "${schema.type}")`);
        parent = value;
        value = value && value[part];
        schema = schema.fields[part];
      }
      lastPart = part;
      lastPartDebug = isBracket ? "[" + _part + "]" : "." + _part;
    });
    return {
      schema,
      parent,
      parentPath: lastPart
    };
  }
  var ReferenceSet = class extends Set {
    describe() {
      const description = [];
      for (const item of this.values()) {
        description.push(Reference.isRef(item) ? item.describe() : item);
      }
      return description;
    }
    resolveAll(resolve) {
      let result = [];
      for (const item of this.values()) {
        result.push(resolve(item));
      }
      return result;
    }
    clone() {
      return new ReferenceSet(this.values());
    }
    merge(newItems, removeItems) {
      const next = this.clone();
      newItems.forEach((value) => next.add(value));
      removeItems.forEach((value) => next.delete(value));
      return next;
    }
  };
  function clone(src3, seen = /* @__PURE__ */ new Map()) {
    if (isSchema(src3) || !src3 || typeof src3 !== "object")
      return src3;
    if (seen.has(src3))
      return seen.get(src3);
    let copy;
    if (src3 instanceof Date) {
      copy = new Date(src3.getTime());
      seen.set(src3, copy);
    } else if (src3 instanceof RegExp) {
      copy = new RegExp(src3);
      seen.set(src3, copy);
    } else if (Array.isArray(src3)) {
      copy = new Array(src3.length);
      seen.set(src3, copy);
      for (let i = 0; i < src3.length; i++)
        copy[i] = clone(src3[i], seen);
    } else if (src3 instanceof Map) {
      copy = /* @__PURE__ */ new Map();
      seen.set(src3, copy);
      for (const [k, v] of src3.entries())
        copy.set(k, clone(v, seen));
    } else if (src3 instanceof Set) {
      copy = /* @__PURE__ */ new Set();
      seen.set(src3, copy);
      for (const v of src3)
        copy.add(clone(v, seen));
    } else if (src3 instanceof Object) {
      copy = {};
      seen.set(src3, copy);
      for (const [k, v] of Object.entries(src3))
        copy[k] = clone(v, seen);
    } else {
      throw Error(`Unable to clone ${src3}`);
    }
    return copy;
  }
  var Schema = class {
    constructor(options) {
      this.type = void 0;
      this.deps = [];
      this.tests = void 0;
      this.transforms = void 0;
      this.conditions = [];
      this._mutate = void 0;
      this.internalTests = {};
      this._whitelist = new ReferenceSet();
      this._blacklist = new ReferenceSet();
      this.exclusiveTests = /* @__PURE__ */ Object.create(null);
      this._typeCheck = void 0;
      this.spec = void 0;
      this.tests = [];
      this.transforms = [];
      this.withMutation(() => {
        this.typeError(mixed.notType);
      });
      this.type = options.type;
      this._typeCheck = options.check;
      this.spec = Object.assign({
        strip: false,
        strict: false,
        abortEarly: true,
        recursive: true,
        nullable: false,
        optional: true,
        coerce: true
      }, options == null ? void 0 : options.spec);
      this.withMutation((s) => {
        s.nonNullable();
      });
    }
    // TODO: remove
    get _type() {
      return this.type;
    }
    clone(spec) {
      if (this._mutate) {
        if (spec)
          Object.assign(this.spec, spec);
        return this;
      }
      const next = Object.create(Object.getPrototypeOf(this));
      next.type = this.type;
      next._typeCheck = this._typeCheck;
      next._whitelist = this._whitelist.clone();
      next._blacklist = this._blacklist.clone();
      next.internalTests = Object.assign({}, this.internalTests);
      next.exclusiveTests = Object.assign({}, this.exclusiveTests);
      next.deps = [...this.deps];
      next.conditions = [...this.conditions];
      next.tests = [...this.tests];
      next.transforms = [...this.transforms];
      next.spec = clone(Object.assign({}, this.spec, spec));
      return next;
    }
    label(label) {
      let next = this.clone();
      next.spec.label = label;
      return next;
    }
    meta(...args) {
      if (args.length === 0)
        return this.spec.meta;
      let next = this.clone();
      next.spec.meta = Object.assign(next.spec.meta || {}, args[0]);
      return next;
    }
    withMutation(fn) {
      let before = this._mutate;
      this._mutate = true;
      let result = fn(this);
      this._mutate = before;
      return result;
    }
    concat(schema) {
      if (!schema || schema === this)
        return this;
      if (schema.type !== this.type && this.type !== "mixed")
        throw new TypeError(`You cannot \`concat()\` schema's of different types: ${this.type} and ${schema.type}`);
      let base4 = this;
      let combined = schema.clone();
      const mergedSpec = Object.assign({}, base4.spec, combined.spec);
      combined.spec = mergedSpec;
      combined.internalTests = Object.assign({}, base4.internalTests, combined.internalTests);
      combined._whitelist = base4._whitelist.merge(schema._whitelist, schema._blacklist);
      combined._blacklist = base4._blacklist.merge(schema._blacklist, schema._whitelist);
      combined.tests = base4.tests;
      combined.exclusiveTests = base4.exclusiveTests;
      combined.withMutation((next) => {
        schema.tests.forEach((fn) => {
          next.test(fn.OPTIONS);
        });
      });
      combined.transforms = [...base4.transforms, ...combined.transforms];
      return combined;
    }
    isType(v) {
      if (v == null) {
        if (this.spec.nullable && v === null)
          return true;
        if (this.spec.optional && v === void 0)
          return true;
        return false;
      }
      return this._typeCheck(v);
    }
    resolve(options) {
      let schema = this;
      if (schema.conditions.length) {
        let conditions = schema.conditions;
        schema = schema.clone();
        schema.conditions = [];
        schema = conditions.reduce((prevSchema, condition) => condition.resolve(prevSchema, options), schema);
        schema = schema.resolve(options);
      }
      return schema;
    }
    resolveOptions(options) {
      var _options$strict, _options$abortEarly, _options$recursive;
      return Object.assign({}, options, {
        from: options.from || [],
        strict: (_options$strict = options.strict) != null ? _options$strict : this.spec.strict,
        abortEarly: (_options$abortEarly = options.abortEarly) != null ? _options$abortEarly : this.spec.abortEarly,
        recursive: (_options$recursive = options.recursive) != null ? _options$recursive : this.spec.recursive
      });
    }
    /**
     * Run the configured transform pipeline over an input value.
     */
    cast(value, options = {}) {
      let resolvedSchema = this.resolve(Object.assign({
        value
      }, options));
      let allowOptionality = options.assert === "ignore-optionality";
      let result = resolvedSchema._cast(value, options);
      if (options.assert !== false && !resolvedSchema.isType(result)) {
        if (allowOptionality && isAbsent(result)) {
          return result;
        }
        let formattedValue = printValue(value);
        let formattedResult = printValue(result);
        throw new TypeError(`The value of ${options.path || "field"} could not be cast to a value that satisfies the schema type: "${resolvedSchema.type}". 

attempted value: ${formattedValue} 
` + (formattedResult !== formattedValue ? `result of cast: ${formattedResult}` : ""));
      }
      return result;
    }
    _cast(rawValue, options) {
      let value = rawValue === void 0 ? rawValue : this.transforms.reduce((prevValue, fn) => fn.call(this, prevValue, rawValue, this), rawValue);
      if (value === void 0) {
        value = this.getDefault(options);
      }
      return value;
    }
    _validate(_value, options = {}, panic, next) {
      let {
        path,
        originalValue = _value,
        strict = this.spec.strict
      } = options;
      let value = _value;
      if (!strict) {
        value = this._cast(value, Object.assign({
          assert: false
        }, options));
      }
      let initialTests = [];
      for (let test of Object.values(this.internalTests)) {
        if (test)
          initialTests.push(test);
      }
      this.runTests({
        path,
        value,
        originalValue,
        options,
        tests: initialTests
      }, panic, (initialErrors) => {
        if (initialErrors.length) {
          return next(initialErrors, value);
        }
        this.runTests({
          path,
          value,
          originalValue,
          options,
          tests: this.tests
        }, panic, next);
      });
    }
    /**
     * Executes a set of validations, either schema, produced Tests or a nested
     * schema validate result.
     */
    runTests(runOptions, panic, next) {
      let fired = false;
      let {
        tests,
        value,
        originalValue,
        path,
        options
      } = runOptions;
      let panicOnce = (arg) => {
        if (fired)
          return;
        fired = true;
        panic(arg, value);
      };
      let nextOnce = (arg) => {
        if (fired)
          return;
        fired = true;
        next(arg, value);
      };
      let count = tests.length;
      let nestedErrors = [];
      if (!count)
        return nextOnce([]);
      let args = {
        value,
        originalValue,
        path,
        options,
        schema: this
      };
      for (let i = 0; i < tests.length; i++) {
        const test = tests[i];
        test(args, panicOnce, function finishTestRun(err) {
          if (err) {
            nestedErrors = nestedErrors.concat(err);
          }
          if (--count <= 0) {
            nextOnce(nestedErrors);
          }
        });
      }
    }
    asNestedTest({
                   key,
                   index,
                   parent,
                   parentPath,
                   originalParent,
                   options
                 }) {
      const k = key != null ? key : index;
      if (k == null) {
        throw TypeError("Must include `key` or `index` for nested validations");
      }
      const isIndex = typeof k === "number";
      let value = parent[k];
      const testOptions = Object.assign({}, options, {
        // Nested validations fields are always strict:
        //    1. parent isn't strict so the casting will also have cast inner values
        //    2. parent is strict in which case the nested values weren't cast either
        strict: true,
        parent,
        value,
        originalValue: originalParent[k],
        // FIXME: tests depend on `index` being passed around deeply,
        //   we should not let the options.key/index bleed through
        key: void 0,
        // index: undefined,
        [isIndex ? "index" : "key"]: k,
        path: isIndex || k.includes(".") ? `${parentPath || ""}[${value ? k : `"${k}"`}]` : (parentPath ? `${parentPath}.` : "") + key
      });
      return (_, panic, next) => this.resolve(testOptions)._validate(value, testOptions, panic, next);
    }
    validate(value, options) {
      let schema = this.resolve(Object.assign({}, options, {
        value
      }));
      return new Promise((resolve, reject) => schema._validate(value, options, (error, parsed) => {
        if (ValidationError.isError(error))
          error.value = parsed;
        reject(error);
      }, (errors, validated) => {
        if (errors.length)
          reject(new ValidationError(errors, validated));
        else
          resolve(validated);
      }));
    }
    validateSync(value, options) {
      let schema = this.resolve(Object.assign({}, options, {
        value
      }));
      let result;
      schema._validate(value, Object.assign({}, options, {
        sync: true
      }), (error, parsed) => {
        if (ValidationError.isError(error))
          error.value = parsed;
        throw error;
      }, (errors, validated) => {
        if (errors.length)
          throw new ValidationError(errors, value);
        result = validated;
      });
      return result;
    }
    isValid(value, options) {
      return this.validate(value, options).then(() => true, (err) => {
        if (ValidationError.isError(err))
          return false;
        throw err;
      });
    }
    isValidSync(value, options) {
      try {
        this.validateSync(value, options);
        return true;
      } catch (err) {
        if (ValidationError.isError(err))
          return false;
        throw err;
      }
    }
    _getDefault(_options) {
      let defaultValue = this.spec.default;
      if (defaultValue == null) {
        return defaultValue;
      }
      return typeof defaultValue === "function" ? defaultValue.call(this) : clone(defaultValue);
    }
    getDefault(options) {
      let schema = this.resolve(options || {});
      return schema._getDefault(options);
    }
    default(def) {
      if (arguments.length === 0) {
        return this._getDefault();
      }
      let next = this.clone({
        default: def
      });
      return next;
    }
    strict(isStrict = true) {
      return this.clone({
        strict: isStrict
      });
    }
    nullability(nullable, message) {
      const next = this.clone({
        nullable
      });
      next.internalTests.nullable = createValidation({
        message,
        name: "nullable",
        test(value) {
          return value === null ? this.schema.spec.nullable : true;
        }
      });
      return next;
    }
    optionality(optional, message) {
      const next = this.clone({
        optional
      });
      next.internalTests.optionality = createValidation({
        message,
        name: "optionality",
        test(value) {
          return value === void 0 ? this.schema.spec.optional : true;
        }
      });
      return next;
    }
    optional() {
      return this.optionality(true);
    }
    defined(message = mixed.defined) {
      return this.optionality(false, message);
    }
    nullable() {
      return this.nullability(true);
    }
    nonNullable(message = mixed.notNull) {
      return this.nullability(false, message);
    }
    required(message = mixed.required) {
      return this.clone().withMutation((next) => next.nonNullable(message).defined(message));
    }
    notRequired() {
      return this.clone().withMutation((next) => next.nullable().optional());
    }
    transform(fn) {
      let next = this.clone();
      next.transforms.push(fn);
      return next;
    }
    /**
     * Adds a test function to the schema's queue of tests.
     * tests can be exclusive or non-exclusive.
     *
     * - exclusive tests, will replace any existing tests of the same name.
     * - non-exclusive: can be stacked
     *
     * If a non-exclusive test is added to a schema with an exclusive test of the same name
     * the exclusive test is removed and further tests of the same name will be stacked.
     *
     * If an exclusive test is added to a schema with non-exclusive tests of the same name
     * the previous tests are removed and further tests of the same name will replace each other.
     */
    test(...args) {
      let opts;
      if (args.length === 1) {
        if (typeof args[0] === "function") {
          opts = {
            test: args[0]
          };
        } else {
          opts = args[0];
        }
      } else if (args.length === 2) {
        opts = {
          name: args[0],
          test: args[1]
        };
      } else {
        opts = {
          name: args[0],
          message: args[1],
          test: args[2]
        };
      }
      if (opts.message === void 0)
        opts.message = mixed.default;
      if (typeof opts.test !== "function")
        throw new TypeError("`test` is a required parameters");
      let next = this.clone();
      let validate = createValidation(opts);
      let isExclusive = opts.exclusive || opts.name && next.exclusiveTests[opts.name] === true;
      if (opts.exclusive) {
        if (!opts.name)
          throw new TypeError("Exclusive tests must provide a unique `name` identifying the test");
      }
      if (opts.name)
        next.exclusiveTests[opts.name] = !!opts.exclusive;
      next.tests = next.tests.filter((fn) => {
        if (fn.OPTIONS.name === opts.name) {
          if (isExclusive)
            return false;
          if (fn.OPTIONS.test === validate.OPTIONS.test)
            return false;
        }
        return true;
      });
      next.tests.push(validate);
      return next;
    }
    when(keys, options) {
      if (!Array.isArray(keys) && typeof keys !== "string") {
        options = keys;
        keys = ".";
      }
      let next = this.clone();
      let deps = toArray(keys).map((key) => new Reference(key));
      deps.forEach((dep) => {
        if (dep.isSibling)
          next.deps.push(dep.key);
      });
      next.conditions.push(typeof options === "function" ? new Condition(deps, options) : Condition.fromOptions(deps, options));
      return next;
    }
    typeError(message) {
      let next = this.clone();
      next.internalTests.typeError = createValidation({
        message,
        name: "typeError",
        skipAbsent: true,
        test(value) {
          if (!this.schema._typeCheck(value))
            return this.createError({
              params: {
                type: this.schema.type
              }
            });
          return true;
        }
      });
      return next;
    }
    oneOf(enums, message = mixed.oneOf) {
      let next = this.clone();
      enums.forEach((val) => {
        next._whitelist.add(val);
        next._blacklist.delete(val);
      });
      next.internalTests.whiteList = createValidation({
        message,
        name: "oneOf",
        skipAbsent: true,
        test(value) {
          let valids = this.schema._whitelist;
          let resolved = valids.resolveAll(this.resolve);
          return resolved.includes(value) ? true : this.createError({
            params: {
              values: Array.from(valids).join(", "),
              resolved
            }
          });
        }
      });
      return next;
    }
    notOneOf(enums, message = mixed.notOneOf) {
      let next = this.clone();
      enums.forEach((val) => {
        next._blacklist.add(val);
        next._whitelist.delete(val);
      });
      next.internalTests.blacklist = createValidation({
        message,
        name: "notOneOf",
        test(value) {
          let invalids = this.schema._blacklist;
          let resolved = invalids.resolveAll(this.resolve);
          if (resolved.includes(value))
            return this.createError({
              params: {
                values: Array.from(invalids).join(", "),
                resolved
              }
            });
          return true;
        }
      });
      return next;
    }
    strip(strip = true) {
      let next = this.clone();
      next.spec.strip = strip;
      return next;
    }
    /**
     * Return a serialized description of the schema including validations, flags, types etc.
     *
     * @param options Provide any needed context for resolving runtime schema alterations (lazy, when conditions, etc).
     */
    describe(options) {
      const next = (options ? this.resolve(options) : this).clone();
      const {
        label,
        meta,
        optional,
        nullable
      } = next.spec;
      const description = {
        meta,
        label,
        optional,
        nullable,
        default: next.getDefault(options),
        type: next.type,
        oneOf: next._whitelist.describe(),
        notOneOf: next._blacklist.describe(),
        tests: next.tests.map((fn) => ({
          name: fn.OPTIONS.name,
          params: fn.OPTIONS.params
        })).filter((n, idx, list) => list.findIndex((c) => c.name === n.name) === idx)
      };
      return description;
    }
  };
  Schema.prototype.__isYupSchema__ = true;
  for (const method of ["validate", "validateSync"])
    Schema.prototype[`${method}At`] = function(path, value, options = {}) {
      const {
        parent,
        parentPath,
        schema
      } = getIn(this, path, value, options.context);
      return schema[method](parent && parent[parentPath], Object.assign({}, options, {
        parent,
        path
      }));
    };
  for (const alias of ["equals", "is"])
    Schema.prototype[alias] = Schema.prototype.oneOf;
  for (const alias of ["not", "nope"])
    Schema.prototype[alias] = Schema.prototype.notOneOf;
  var returnsTrue = () => true;
  function create$8(spec) {
    return new MixedSchema(spec);
  }
  var MixedSchema = class extends Schema {
    constructor(spec) {
      super(typeof spec === "function" ? {
        type: "mixed",
        check: spec
      } : Object.assign({
        type: "mixed",
        check: returnsTrue
      }, spec));
    }
  };
  create$8.prototype = MixedSchema.prototype;
  function create$7() {
    return new BooleanSchema();
  }
  var BooleanSchema = class extends Schema {
    constructor() {
      super({
        type: "boolean",
        check(v) {
          if (v instanceof Boolean)
            v = v.valueOf();
          return typeof v === "boolean";
        }
      });
      this.withMutation(() => {
        this.transform((value, _raw, ctx) => {
          if (ctx.spec.coerce && !ctx.isType(value)) {
            if (/^(true|1)$/i.test(String(value)))
              return true;
            if (/^(false|0)$/i.test(String(value)))
              return false;
          }
          return value;
        });
      });
    }
    isTrue(message = boolean.isValue) {
      return this.test({
        message,
        name: "is-value",
        exclusive: true,
        params: {
          value: "true"
        },
        test(value) {
          return isAbsent(value) || value === true;
        }
      });
    }
    isFalse(message = boolean.isValue) {
      return this.test({
        message,
        name: "is-value",
        exclusive: true,
        params: {
          value: "false"
        },
        test(value) {
          return isAbsent(value) || value === false;
        }
      });
    }
    default(def) {
      return super.default(def);
    }
    defined(msg) {
      return super.defined(msg);
    }
    optional() {
      return super.optional();
    }
    required(msg) {
      return super.required(msg);
    }
    notRequired() {
      return super.notRequired();
    }
    nullable() {
      return super.nullable();
    }
    nonNullable(msg) {
      return super.nonNullable(msg);
    }
    strip(v) {
      return super.strip(v);
    }
  };
  create$7.prototype = BooleanSchema.prototype;
  var rEmail = (
      // eslint-disable-next-line
      /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  );
  var rUrl = (
      // eslint-disable-next-line
      /^((https?|ftp):)?\/\/(((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:)*@)?(((\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5]))|((([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.)+(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.?)(:\d*)?)(\/((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)?)?(\?((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|[\uE000-\uF8FF]|\/|\?)*)?(\#((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|\/|\?)*)?$/i
  );
  var rUUID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;
  var isTrimmed = (value) => isAbsent(value) || value === value.trim();
  var objStringTag = {}.toString();
  function create$6() {
    return new StringSchema();
  }
  var StringSchema = class extends Schema {
    constructor() {
      super({
        type: "string",
        check(value) {
          if (value instanceof String)
            value = value.valueOf();
          return typeof value === "string";
        }
      });
      this.withMutation(() => {
        this.transform((value, _raw, ctx) => {
          if (!ctx.spec.coerce || ctx.isType(value))
            return value;
          if (Array.isArray(value))
            return value;
          const strValue = value != null && value.toString ? value.toString() : value;
          if (strValue === objStringTag)
            return value;
          return strValue;
        });
      });
    }
    required(message) {
      return super.required(message).withMutation((schema) => schema.test({
        message: message || mixed.required,
        name: "required",
        skipAbsent: true,
        test: (value) => !!value.length
      }));
    }
    notRequired() {
      return super.notRequired().withMutation((schema) => {
        schema.tests = schema.tests.filter((t) => t.OPTIONS.name !== "required");
        return schema;
      });
    }
    length(length4, message = string3.length) {
      return this.test({
        message,
        name: "length",
        exclusive: true,
        params: {
          length: length4
        },
        skipAbsent: true,
        test(value) {
          return value.length === this.resolve(length4);
        }
      });
    }
    min(min, message = string3.min) {
      return this.test({
        message,
        name: "min",
        exclusive: true,
        params: {
          min
        },
        skipAbsent: true,
        test(value) {
          return value.length >= this.resolve(min);
        }
      });
    }
    max(max, message = string3.max) {
      return this.test({
        name: "max",
        exclusive: true,
        message,
        params: {
          max
        },
        skipAbsent: true,
        test(value) {
          return value.length <= this.resolve(max);
        }
      });
    }
    matches(regex, options) {
      let excludeEmptyString = false;
      let message;
      let name4;
      if (options) {
        if (typeof options === "object") {
          ({
            excludeEmptyString = false,
            message,
            name: name4
          } = options);
        } else {
          message = options;
        }
      }
      return this.test({
        name: name4 || "matches",
        message: message || string3.matches,
        params: {
          regex
        },
        skipAbsent: true,
        test: (value) => value === "" && excludeEmptyString || value.search(regex) !== -1
      });
    }
    email(message = string3.email) {
      return this.matches(rEmail, {
        name: "email",
        message,
        excludeEmptyString: true
      });
    }
    url(message = string3.url) {
      return this.matches(rUrl, {
        name: "url",
        message,
        excludeEmptyString: true
      });
    }
    uuid(message = string3.uuid) {
      return this.matches(rUUID, {
        name: "uuid",
        message,
        excludeEmptyString: false
      });
    }
    //-- transforms --
    ensure() {
      return this.default("").transform((val) => val === null ? "" : val);
    }
    trim(message = string3.trim) {
      return this.transform((val) => val != null ? val.trim() : val).test({
        message,
        name: "trim",
        test: isTrimmed
      });
    }
    lowercase(message = string3.lowercase) {
      return this.transform((value) => !isAbsent(value) ? value.toLowerCase() : value).test({
        message,
        name: "string_case",
        exclusive: true,
        skipAbsent: true,
        test: (value) => isAbsent(value) || value === value.toLowerCase()
      });
    }
    uppercase(message = string3.uppercase) {
      return this.transform((value) => !isAbsent(value) ? value.toUpperCase() : value).test({
        message,
        name: "string_case",
        exclusive: true,
        skipAbsent: true,
        test: (value) => isAbsent(value) || value === value.toUpperCase()
      });
    }
  };
  create$6.prototype = StringSchema.prototype;
  var isNaN$1 = (value) => value != +value;
  function create$5() {
    return new NumberSchema();
  }
  var NumberSchema = class extends Schema {
    constructor() {
      super({
        type: "number",
        check(value) {
          if (value instanceof Number)
            value = value.valueOf();
          return typeof value === "number" && !isNaN$1(value);
        }
      });
      this.withMutation(() => {
        this.transform((value, _raw, ctx) => {
          if (!ctx.spec.coerce)
            return value;
          let parsed = value;
          if (typeof parsed === "string") {
            parsed = parsed.replace(/\s/g, "");
            if (parsed === "")
              return NaN;
            parsed = +parsed;
          }
          if (ctx.isType(parsed) || parsed === null)
            return parsed;
          return parseFloat(parsed);
        });
      });
    }
    min(min, message = number2.min) {
      return this.test({
        message,
        name: "min",
        exclusive: true,
        params: {
          min
        },
        skipAbsent: true,
        test(value) {
          return value >= this.resolve(min);
        }
      });
    }
    max(max, message = number2.max) {
      return this.test({
        message,
        name: "max",
        exclusive: true,
        params: {
          max
        },
        skipAbsent: true,
        test(value) {
          return value <= this.resolve(max);
        }
      });
    }
    lessThan(less, message = number2.lessThan) {
      return this.test({
        message,
        name: "max",
        exclusive: true,
        params: {
          less
        },
        skipAbsent: true,
        test(value) {
          return value < this.resolve(less);
        }
      });
    }
    moreThan(more, message = number2.moreThan) {
      return this.test({
        message,
        name: "min",
        exclusive: true,
        params: {
          more
        },
        skipAbsent: true,
        test(value) {
          return value > this.resolve(more);
        }
      });
    }
    positive(msg = number2.positive) {
      return this.moreThan(0, msg);
    }
    negative(msg = number2.negative) {
      return this.lessThan(0, msg);
    }
    integer(message = number2.integer) {
      return this.test({
        name: "integer",
        message,
        skipAbsent: true,
        test: (val) => Number.isInteger(val)
      });
    }
    truncate() {
      return this.transform((value) => !isAbsent(value) ? value | 0 : value);
    }
    round(method) {
      var _method;
      let avail = ["ceil", "floor", "round", "trunc"];
      method = ((_method = method) == null ? void 0 : _method.toLowerCase()) || "round";
      if (method === "trunc")
        return this.truncate();
      if (avail.indexOf(method.toLowerCase()) === -1)
        throw new TypeError("Only valid options for round() are: " + avail.join(", "));
      return this.transform((value) => !isAbsent(value) ? Math[method](value) : value);
    }
  };
  create$5.prototype = NumberSchema.prototype;
  var isoReg = /^(\d{4}|[+\-]\d{6})(?:-?(\d{2})(?:-?(\d{2}))?)?(?:[ T]?(\d{2}):?(\d{2})(?::?(\d{2})(?:[,\.](\d{1,}))?)?(?:(Z)|([+\-])(\d{2})(?::?(\d{2}))?)?)?$/;
  function parseIsoDate(date2) {
    var numericKeys = [1, 4, 5, 6, 7, 10, 11], minutesOffset = 0, timestamp, struct;
    if (struct = isoReg.exec(date2)) {
      for (var i = 0, k; k = numericKeys[i]; ++i)
        struct[k] = +struct[k] || 0;
      struct[2] = (+struct[2] || 1) - 1;
      struct[3] = +struct[3] || 1;
      struct[7] = struct[7] ? String(struct[7]).substr(0, 3) : 0;
      if ((struct[8] === void 0 || struct[8] === "") && (struct[9] === void 0 || struct[9] === ""))
        timestamp = +new Date(struct[1], struct[2], struct[3], struct[4], struct[5], struct[6], struct[7]);
      else {
        if (struct[8] !== "Z" && struct[9] !== void 0) {
          minutesOffset = struct[10] * 60 + struct[11];
          if (struct[9] === "+")
            minutesOffset = 0 - minutesOffset;
        }
        timestamp = Date.UTC(struct[1], struct[2], struct[3], struct[4], struct[5] + minutesOffset, struct[6], struct[7]);
      }
    } else
      timestamp = Date.parse ? Date.parse(date2) : NaN;
    return timestamp;
  }
  var invalidDate = /* @__PURE__ */ new Date("");
  var isDate = (obj) => Object.prototype.toString.call(obj) === "[object Date]";
  function create$4() {
    return new DateSchema();
  }
  var DateSchema = class extends Schema {
    constructor() {
      super({
        type: "date",
        check(v) {
          return isDate(v) && !isNaN(v.getTime());
        }
      });
      this.withMutation(() => {
        this.transform((value, _raw, ctx) => {
          if (!ctx.spec.coerce || ctx.isType(value) || value === null)
            return value;
          value = parseIsoDate(value);
          return !isNaN(value) ? new Date(value) : DateSchema.INVALID_DATE;
        });
      });
    }
    prepareParam(ref, name4) {
      let param;
      if (!Reference.isRef(ref)) {
        let cast = this.cast(ref);
        if (!this._typeCheck(cast))
          throw new TypeError(`\`${name4}\` must be a Date or a value that can be \`cast()\` to a Date`);
        param = cast;
      } else {
        param = ref;
      }
      return param;
    }
    min(min, message = date.min) {
      let limit = this.prepareParam(min, "min");
      return this.test({
        message,
        name: "min",
        exclusive: true,
        params: {
          min
        },
        skipAbsent: true,
        test(value) {
          return value >= this.resolve(limit);
        }
      });
    }
    max(max, message = date.max) {
      let limit = this.prepareParam(max, "max");
      return this.test({
        message,
        name: "max",
        exclusive: true,
        params: {
          max
        },
        skipAbsent: true,
        test(value) {
          return value <= this.resolve(limit);
        }
      });
    }
  };
  DateSchema.INVALID_DATE = invalidDate;
  create$4.prototype = DateSchema.prototype;
  create$4.INVALID_DATE = invalidDate;
  function sortFields(fields, excludedEdges = []) {
    let edges = [];
    let nodes = /* @__PURE__ */ new Set();
    let excludes = new Set(excludedEdges.map(([a, b]) => `${a}-${b}`));
    function addNode(depPath, key) {
      let node = (0, import_property_expr.split)(depPath)[0];
      nodes.add(node);
      if (!excludes.has(`${key}-${node}`))
        edges.push([key, node]);
    }
    for (const key of Object.keys(fields)) {
      let value = fields[key];
      nodes.add(key);
      if (Reference.isRef(value) && value.isSibling)
        addNode(value.path, key);
      else if (isSchema(value) && "deps" in value)
        value.deps.forEach((path) => addNode(path, key));
    }
    return import_toposort.default.array(Array.from(nodes), edges).reverse();
  }
  function findIndex(arr, err) {
    let idx = Infinity;
    arr.some((key, ii) => {
      var _err$path;
      if ((_err$path = err.path) != null && _err$path.includes(key)) {
        idx = ii;
        return true;
      }
    });
    return idx;
  }
  function sortByKeyOrder(keys) {
    return (a, b) => {
      return findIndex(keys, a) - findIndex(keys, b);
    };
  }
  var parseJson = (value, _, ctx) => {
    if (typeof value !== "string") {
      return value;
    }
    let parsed = value;
    try {
      parsed = JSON.parse(value);
    } catch (err) {
    }
    return ctx.isType(parsed) ? parsed : value;
  };
  function deepPartial(schema) {
    if ("fields" in schema) {
      const partial = {};
      for (const [key, fieldSchema] of Object.entries(schema.fields)) {
        partial[key] = deepPartial(fieldSchema);
      }
      return schema.setFields(partial);
    }
    if (schema.type === "array") {
      const nextArray = schema.optional();
      if (nextArray.innerType)
        nextArray.innerType = deepPartial(nextArray.innerType);
      return nextArray;
    }
    if (schema.type === "tuple") {
      return schema.optional().clone({
        types: schema.spec.types.map(deepPartial)
      });
    }
    if ("optional" in schema) {
      return schema.optional();
    }
    return schema;
  }
  var deepHas = (obj, p) => {
    const path = [...(0, import_property_expr.normalizePath)(p)];
    if (path.length === 1)
      return path[0] in obj;
    let last = path.pop();
    let parent = (0, import_property_expr.getter)((0, import_property_expr.join)(path), true)(obj);
    return !!(parent && last in parent);
  };
  var isObject = (obj) => Object.prototype.toString.call(obj) === "[object Object]";
  function unknown(ctx, value) {
    let known = Object.keys(ctx.fields);
    return Object.keys(value).filter((key) => known.indexOf(key) === -1);
  }
  var defaultSort = sortByKeyOrder([]);
  function create$3(spec) {
    return new ObjectSchema(spec);
  }
  var ObjectSchema = class extends Schema {
    constructor(spec) {
      super({
        type: "object",
        check(value) {
          return isObject(value) || typeof value === "function";
        }
      });
      this.fields = /* @__PURE__ */ Object.create(null);
      this._sortErrors = defaultSort;
      this._nodes = [];
      this._excludedEdges = [];
      this.withMutation(() => {
        if (spec) {
          this.shape(spec);
        }
      });
    }
    _cast(_value, options = {}) {
      var _options$stripUnknown;
      let value = super._cast(_value, options);
      if (value === void 0)
        return this.getDefault(options);
      if (!this._typeCheck(value))
        return value;
      let fields = this.fields;
      let strip = (_options$stripUnknown = options.stripUnknown) != null ? _options$stripUnknown : this.spec.noUnknown;
      let props = [].concat(this._nodes, Object.keys(value).filter((v) => !this._nodes.includes(v)));
      let intermediateValue = {};
      let innerOptions = Object.assign({}, options, {
        parent: intermediateValue,
        __validating: options.__validating || false
      });
      let isChanged = false;
      for (const prop of props) {
        let field = fields[prop];
        let exists2 = prop in value;
        if (field) {
          let fieldValue;
          let inputValue = value[prop];
          innerOptions.path = (options.path ? `${options.path}.` : "") + prop;
          field = field.resolve({
            value: inputValue,
            context: options.context,
            parent: intermediateValue
          });
          let fieldSpec = field instanceof Schema ? field.spec : void 0;
          let strict = fieldSpec == null ? void 0 : fieldSpec.strict;
          if (fieldSpec != null && fieldSpec.strip) {
            isChanged = isChanged || prop in value;
            continue;
          }
          fieldValue = !options.__validating || !strict ? (
              // TODO: use _cast, this is double resolving
              field.cast(value[prop], innerOptions)
          ) : value[prop];
          if (fieldValue !== void 0) {
            intermediateValue[prop] = fieldValue;
          }
        } else if (exists2 && !strip) {
          intermediateValue[prop] = value[prop];
        }
        if (exists2 !== prop in intermediateValue || intermediateValue[prop] !== value[prop]) {
          isChanged = true;
        }
      }
      return isChanged ? intermediateValue : value;
    }
    _validate(_value, options = {}, panic, next) {
      let {
        from: from5 = [],
        originalValue = _value,
        recursive = this.spec.recursive
      } = options;
      options.from = [{
        schema: this,
        value: originalValue
      }, ...from5];
      options.__validating = true;
      options.originalValue = originalValue;
      super._validate(_value, options, panic, (objectErrors, value) => {
        if (!recursive || !isObject(value)) {
          next(objectErrors, value);
          return;
        }
        originalValue = originalValue || value;
        let tests = [];
        for (let key of this._nodes) {
          let field = this.fields[key];
          if (!field || Reference.isRef(field)) {
            continue;
          }
          tests.push(field.asNestedTest({
            options,
            key,
            parent: value,
            parentPath: options.path,
            originalParent: originalValue
          }));
        }
        this.runTests({
          tests,
          value,
          originalValue,
          options
        }, panic, (fieldErrors) => {
          next(fieldErrors.sort(this._sortErrors).concat(objectErrors), value);
        });
      });
    }
    clone(spec) {
      const next = super.clone(spec);
      next.fields = Object.assign({}, this.fields);
      next._nodes = this._nodes;
      next._excludedEdges = this._excludedEdges;
      next._sortErrors = this._sortErrors;
      return next;
    }
    concat(schema) {
      let next = super.concat(schema);
      let nextFields = next.fields;
      for (let [field, schemaOrRef] of Object.entries(this.fields)) {
        const target = nextFields[field];
        nextFields[field] = target === void 0 ? schemaOrRef : target;
      }
      return next.withMutation((s) => (
          // XXX: excludes here is wrong
          s.setFields(nextFields, [...this._excludedEdges, ...schema._excludedEdges])
      ));
    }
    _getDefault(options) {
      if ("default" in this.spec) {
        return super._getDefault(options);
      }
      if (!this._nodes.length) {
        return void 0;
      }
      let dft = {};
      this._nodes.forEach((key) => {
        var _innerOptions;
        const field = this.fields[key];
        let innerOptions = options;
        if ((_innerOptions = innerOptions) != null && _innerOptions.value) {
          innerOptions = Object.assign({}, innerOptions, {
            parent: innerOptions.value,
            value: innerOptions.value[key]
          });
        }
        dft[key] = field && "getDefault" in field ? field.getDefault(innerOptions) : void 0;
      });
      return dft;
    }
    setFields(shape, excludedEdges) {
      let next = this.clone();
      next.fields = shape;
      next._nodes = sortFields(shape, excludedEdges);
      next._sortErrors = sortByKeyOrder(Object.keys(shape));
      if (excludedEdges)
        next._excludedEdges = excludedEdges;
      return next;
    }
    shape(additions, excludes = []) {
      return this.clone().withMutation((next) => {
        let edges = next._excludedEdges;
        if (excludes.length) {
          if (!Array.isArray(excludes[0]))
            excludes = [excludes];
          edges = [...next._excludedEdges, ...excludes];
        }
        return next.setFields(Object.assign(next.fields, additions), edges);
      });
    }
    partial() {
      const partial = {};
      for (const [key, schema] of Object.entries(this.fields)) {
        partial[key] = "optional" in schema && schema.optional instanceof Function ? schema.optional() : schema;
      }
      return this.setFields(partial);
    }
    deepPartial() {
      const next = deepPartial(this);
      return next;
    }
    pick(keys) {
      const picked = {};
      for (const key of keys) {
        if (this.fields[key])
          picked[key] = this.fields[key];
      }
      return this.setFields(picked);
    }
    omit(keys) {
      const fields = Object.assign({}, this.fields);
      for (const key of keys) {
        delete fields[key];
      }
      return this.setFields(fields);
    }
    from(from5, to, alias) {
      let fromGetter = (0, import_property_expr.getter)(from5, true);
      return this.transform((obj) => {
        if (!obj)
          return obj;
        let newObj = obj;
        if (deepHas(obj, from5)) {
          newObj = Object.assign({}, obj);
          if (!alias)
            delete newObj[from5];
          newObj[to] = fromGetter(obj);
        }
        return newObj;
      });
    }
    /** Parse an input JSON string to an object */
    json() {
      return this.transform(parseJson);
    }
    noUnknown(noAllow = true, message = object.noUnknown) {
      if (typeof noAllow !== "boolean") {
        message = noAllow;
        noAllow = true;
      }
      let next = this.test({
        name: "noUnknown",
        exclusive: true,
        message,
        test(value) {
          if (value == null)
            return true;
          const unknownKeys = unknown(this.schema, value);
          return !noAllow || unknownKeys.length === 0 || this.createError({
            params: {
              unknown: unknownKeys.join(", ")
            }
          });
        }
      });
      next.spec.noUnknown = noAllow;
      return next;
    }
    unknown(allow = true, message = object.noUnknown) {
      return this.noUnknown(!allow, message);
    }
    transformKeys(fn) {
      return this.transform((obj) => {
        if (!obj)
          return obj;
        const result = {};
        for (const key of Object.keys(obj))
          result[fn(key)] = obj[key];
        return result;
      });
    }
    camelCase() {
      return this.transformKeys(import_tiny_case.camelCase);
    }
    snakeCase() {
      return this.transformKeys(import_tiny_case.snakeCase);
    }
    constantCase() {
      return this.transformKeys((key) => (0, import_tiny_case.snakeCase)(key).toUpperCase());
    }
    describe(options) {
      let base4 = super.describe(options);
      base4.fields = {};
      for (const [key, value] of Object.entries(this.fields)) {
        var _innerOptions2;
        let innerOptions = options;
        if ((_innerOptions2 = innerOptions) != null && _innerOptions2.value) {
          innerOptions = Object.assign({}, innerOptions, {
            parent: innerOptions.value,
            value: innerOptions.value[key]
          });
        }
        base4.fields[key] = value.describe(innerOptions);
      }
      return base4;
    }
  };
  create$3.prototype = ObjectSchema.prototype;
  function create$2(type) {
    return new ArraySchema(type);
  }
  var ArraySchema = class extends Schema {
    constructor(type) {
      super({
        type: "array",
        spec: {
          types: type
        },
        check(v) {
          return Array.isArray(v);
        }
      });
      this.innerType = void 0;
      this.innerType = type;
    }
    _cast(_value, _opts) {
      const value = super._cast(_value, _opts);
      if (!this._typeCheck(value) || !this.innerType) {
        return value;
      }
      let isChanged = false;
      const castArray = value.map((v, idx) => {
        const castElement = this.innerType.cast(v, Object.assign({}, _opts, {
          path: `${_opts.path || ""}[${idx}]`
        }));
        if (castElement !== v) {
          isChanged = true;
        }
        return castElement;
      });
      return isChanged ? castArray : value;
    }
    _validate(_value, options = {}, panic, next) {
      var _options$recursive;
      let innerType = this.innerType;
      let recursive = (_options$recursive = options.recursive) != null ? _options$recursive : this.spec.recursive;
      options.originalValue != null ? options.originalValue : _value;
      super._validate(_value, options, panic, (arrayErrors, value) => {
        var _options$originalValu2;
        if (!recursive || !innerType || !this._typeCheck(value)) {
          next(arrayErrors, value);
          return;
        }
        let tests = new Array(value.length);
        for (let index = 0; index < value.length; index++) {
          var _options$originalValu;
          tests[index] = innerType.asNestedTest({
            options,
            index,
            parent: value,
            parentPath: options.path,
            originalParent: (_options$originalValu = options.originalValue) != null ? _options$originalValu : _value
          });
        }
        this.runTests({
          value,
          tests,
          originalValue: (_options$originalValu2 = options.originalValue) != null ? _options$originalValu2 : _value,
          options
        }, panic, (innerTypeErrors) => next(innerTypeErrors.concat(arrayErrors), value));
      });
    }
    clone(spec) {
      const next = super.clone(spec);
      next.innerType = this.innerType;
      return next;
    }
    /** Parse an input JSON string to an object */
    json() {
      return this.transform(parseJson);
    }
    concat(schema) {
      let next = super.concat(schema);
      next.innerType = this.innerType;
      if (schema.innerType)
        next.innerType = next.innerType ? (
            // @ts-expect-error Lazy doesn't have concat and will break
            next.innerType.concat(schema.innerType)
        ) : schema.innerType;
      return next;
    }
    of(schema) {
      let next = this.clone();
      if (!isSchema(schema))
        throw new TypeError("`array.of()` sub-schema must be a valid yup schema not: " + printValue(schema));
      next.innerType = schema;
      next.spec = Object.assign({}, next.spec, {
        types: schema
      });
      return next;
    }
    length(length4, message = array.length) {
      return this.test({
        message,
        name: "length",
        exclusive: true,
        params: {
          length: length4
        },
        skipAbsent: true,
        test(value) {
          return value.length === this.resolve(length4);
        }
      });
    }
    min(min, message) {
      message = message || array.min;
      return this.test({
        message,
        name: "min",
        exclusive: true,
        params: {
          min
        },
        skipAbsent: true,
        // FIXME(ts): Array<typeof T>
        test(value) {
          return value.length >= this.resolve(min);
        }
      });
    }
    max(max, message) {
      message = message || array.max;
      return this.test({
        message,
        name: "max",
        exclusive: true,
        params: {
          max
        },
        skipAbsent: true,
        test(value) {
          return value.length <= this.resolve(max);
        }
      });
    }
    ensure() {
      return this.default(() => []).transform((val, original) => {
        if (this._typeCheck(val))
          return val;
        return original == null ? [] : [].concat(original);
      });
    }
    compact(rejector) {
      let reject = !rejector ? (v) => !!v : (v, i, a) => !rejector(v, i, a);
      return this.transform((values) => values != null ? values.filter(reject) : values);
    }
    describe(options) {
      let base4 = super.describe(options);
      if (this.innerType) {
        var _innerOptions;
        let innerOptions = options;
        if ((_innerOptions = innerOptions) != null && _innerOptions.value) {
          innerOptions = Object.assign({}, innerOptions, {
            parent: innerOptions.value,
            value: innerOptions.value[0]
          });
        }
        base4.innerType = this.innerType.describe(innerOptions);
      }
      return base4;
    }
  };
  create$2.prototype = ArraySchema.prototype;
  function create$1(schemas) {
    return new TupleSchema(schemas);
  }
  var TupleSchema = class extends Schema {
    constructor(schemas) {
      super({
        type: "tuple",
        spec: {
          types: schemas
        },
        check(v) {
          const types = this.spec.types;
          return Array.isArray(v) && v.length === types.length;
        }
      });
      this.withMutation(() => {
        this.typeError(tuple.notType);
      });
    }
    _cast(inputValue, options) {
      const {
        types
      } = this.spec;
      const value = super._cast(inputValue, options);
      if (!this._typeCheck(value)) {
        return value;
      }
      let isChanged = false;
      const castArray = types.map((type, idx) => {
        const castElement = type.cast(value[idx], Object.assign({}, options, {
          path: `${options.path || ""}[${idx}]`
        }));
        if (castElement !== value[idx])
          isChanged = true;
        return castElement;
      });
      return isChanged ? castArray : value;
    }
    _validate(_value, options = {}, panic, next) {
      let itemTypes = this.spec.types;
      super._validate(_value, options, panic, (tupleErrors, value) => {
        var _options$originalValu2;
        if (!this._typeCheck(value)) {
          next(tupleErrors, value);
          return;
        }
        let tests = [];
        for (let [index, itemSchema] of itemTypes.entries()) {
          var _options$originalValu;
          tests[index] = itemSchema.asNestedTest({
            options,
            index,
            parent: value,
            parentPath: options.path,
            originalParent: (_options$originalValu = options.originalValue) != null ? _options$originalValu : _value
          });
        }
        this.runTests({
          value,
          tests,
          originalValue: (_options$originalValu2 = options.originalValue) != null ? _options$originalValu2 : _value,
          options
        }, panic, (innerTypeErrors) => next(innerTypeErrors.concat(tupleErrors), value));
      });
    }
    describe(options) {
      let base4 = super.describe(options);
      base4.innerType = this.spec.types.map((schema, index) => {
        var _innerOptions;
        let innerOptions = options;
        if ((_innerOptions = innerOptions) != null && _innerOptions.value) {
          innerOptions = Object.assign({}, innerOptions, {
            parent: innerOptions.value,
            value: innerOptions.value[index]
          });
        }
        return schema.describe(innerOptions);
      });
      return base4;
    }
  };
  create$1.prototype = TupleSchema.prototype;

  // lit_actions/src/main.action.ts
  var CERAMIC_API_URL = "https://ceramic-dev.index.as";
  var getCreatorConditions = () => {
    return __REPLACE_THIS_AS_CONDITIONS_ARRAY__;
  };
  var models = {
    "kjzl6hvfrbw6c9bh2wggilqiije6udtgohahloxhuhbkm0igfjd3pm05z80164h": {
      name: "index",
      validators: {
        update: async (auth, id, current, replace) => {
          return auth.isPermittedAddress;
        },
        create: async (auth, payload) => {
          return auth.isPermittedAddress;
        }
      }
    },
    "kjzl6hvfrbw6c7y832osmzcho78gnurxwflk3rsqhl026wo7uhbhwcnkd0qrcui": {
      name: "index_link",
      validators: {
        update: async (auth, id, current, replace) => {
          if (!(auth.isCreator && auth.personalDID === current.indexer_did || auth.isPermittedAddress)) {
            return false;
          }
          if (replace.length > 1) {
            return false;
          }
          if (replace[0].path !== "/deleted_at") {
            return false;
          }
          return true;
        },
        create: async (auth, payload) => {
          return auth.isPermittedAddress || auth.isCreator;
        }
      }
    }
  };
  var getSchema = () => {
    return {
      auth: create$3({
        did: create$6().required(),
        exp: create$5().required(),
        aud: create$3(),
        nonce: create$6().required(),
        paths: create$2()
      }),
      create: create$3({
        data: create$3().required(),
        header: create$3().required()
      }),
      update: create$3({
        data: create$2().required(),
        id: create$3().required(),
        prev: create$3().required()
      })
    };
  };
  var go = async () => {
    if (typeof ACTION_CALL_MODE !== "undefined") {
      console.log(JSON.stringify(getCreatorConditions()));
      return;
    }
    let context = { auth: { isPermittedAddress: false, isCreator: false }, validation: {} };
    const publicKey = decodeDIDWithLit(did);
    const tokenId = Lit.Actions.pubkeyToTokenId({ publicKey });
    const authSigComponents = authSig.signedMessage.split("\n").filter((i) => i);
    const chainId = authSigComponents[5]?.startsWith("Chain ID: ") ? Number(authSigComponents[5]?.split(": ")[1]) : void 0;
    const personalDID = `did:pkh:eip155:${chainId}:${Lit.Auth.authSigAddress}`;
    context.auth.personalDID = personalDID;
    const isPermittedAddress = await Lit.Actions.isPermittedAddress({ tokenId, address: Lit.Auth.authSigAddress });
    context.auth.isPermittedAddress = isPermittedAddress;
    const conditions = getCreatorConditions();
    let isCreator = false;
    if (conditions.length > 0) {
      isCreator = await Lit.Actions.checkConditions({ conditions, authSig, chain });
      context.auth.isCreator = isCreator;
    }
    if (!isPermittedAddress && !isCreator) {
      LitActions.setResponse({
        response: JSON.stringify({
          code: 401,
          context: JSON.stringify(context)
        })
      });
    }
    let toSignToValidate;
    let toSignObject;
    let method = "not_implemented";
    if (typeof authPayload === "object") {
      toSignToValidate = await getToSign(did, toStableObject(authPayload));
      toSignObject = authPayload;
      method = "auth";
    } else if (linkedBlock) {
      toSignObject = decodeLinkedBlock(linkedBlock);
      const cid = await getCID(toSignObject);
      toSignToValidate = await getToSign(did, cid);
      method = toSignObject.id ? "update" : "create";
    }
    const payloadMatch = arrayEquals(toSign, toSignToValidate);
    const schema = getSchema();
    const isValid = schema[method].isValid(toSignObject);
    if (!payloadMatch || method === "not_implemented" || !isValid) {
      context.validation.schema = isValid;
      context.validation.payloadMatch = payloadMatch;
      context.method = method;
      LitActions.setResponse({
        response: JSON.stringify({
          code: 400,
          context: JSON.stringify(context)
        })
      });
      return;
    }
    let result = false;
    let modelId;
    switch (method) {
      case "auth":
        result = true;
        break;
      case "create":
        modelId = getStreamID(toSignObject.header.model);
        result = await models[modelId].validators["create"](context.auth, toSignObject.data);
        context.modelId = modelId;
        break;
      case "update":
        const commitID = new CommitID(0, toSignObject.id.toString());
        const currentDocAPIUrl = `${CERAMIC_API_URL}/api/v0/streams/${commitID}`;
        const currentDoc = await fetch(currentDocAPIUrl).then((response) => response.json());
        modelId = getStreamID(currentDoc.state.metadata.model.split(","));
        result = await models[modelId].validators["update"](context.auth, currentDoc.streamId, currentDoc.state.content, toSignObject.data);
        context.modelId = modelId;
        break;
    }
    if (!result) {
      LitActions.setResponse({
        response: JSON.stringify({
          code: 403,
          context: JSON.stringify(context)
        })
      });
    }
    context.result = result;
    const sigShare = await LitActions.signEcdsa({
      toSign,
      publicKey,
      sigName
    });
    LitActions.setResponse({
      response: JSON.stringify({
        error: false,
        did,
        context: JSON.stringify(context)
      })
    });
  };
  go();
})();
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
