/*

Functions for working with plain JS objects

*/

const serialize =
exports.serialize =
function serialize(obj) {
  return JSON.stringify(toJson(obj));

  function toJson(obj) {
    if (obj === null || ['number', 'string', 'null', 'boolean'].includes(typeof obj))
      return obj;

    if (Array.isArray(obj))
      return obj.map(toJson);

    if (typeof obj === 'undefined')
      return { _type: 'undefined' };

    if (obj instanceof Set) {
      return toJson({
        _type: 'set',
        values: toJson([...obj]),
      });
    }

    if (Object.getPrototypeOf(obj) === Object.getPrototypeOf({})) {
      const json = {};
      for (const k in obj) {
        json[k] = toJson(obj[k]);
      }
      return json;
    }

    throw Error(`Cannot serialize a ${typeof obj} // ${Object.getPrototypeOf(obj).constructor.name}`);
  }
}

const deserialize =
exports.deserialize =
function deserialize(str) {
  return fromJson(JSON.parse(str));

  function fromJson(json) {
    if (['number', 'string', 'null', 'boolean'].includes(typeof json))
      return json;

    if (json === null)
      return json;

    if (Array.isArray(json))
      return json.map(fromJson);

    if (json._type === 'undefined')
      return undefined;

    if (json._type === 'set') {
      const items = fromJson(json.values);
      return new Set(items);
    }

    const obj = {};
    for (const k in json)
      obj[k] = fromJson(json[k]);
    return obj;
  }
}

// Knows how to clone a blessed set of types
// Assumes that functions are pure and not monkeypatched!
const clone =
exports.clone =
function clone(val) {

  // Assumes we're not monkeypatching functions
  if (typeof val === 'function' || val instanceof Function)
    return val;

  if (val === null || typeof val !== 'object')
    return val;

  if (val instanceof Array)
    return [...val].map(clone);

  if (val instanceof Set)
    return new Set([...val].map(clone));

  // idk why "val instanceof Cats" doesnt work
  if (val.constructor.name === 'Cats')
    return val.clone();

  const proto = Object.getPrototypeOf(val);
  if (proto !== Object.prototype) {
    throw Error(`Refusing to clone non-plain value of type '${proto.constructor.name}'!`);
  }

  const res = {};
  for (const k in val)
    res[k] = clone(val[k]);
  return res;

}
