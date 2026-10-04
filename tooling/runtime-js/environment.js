'use strict';

const { DaCodeRuntimeError, checkType } = require('./values');

class Environment {
  constructor(parent = null) {
    this.parent = parent;
    this.vars = new Map();
    this.opened = false;
  }

  define(name, value, typeSpec = null, blocked = false) {
    this.vars.set(name, { value, typeSpec, blocked });
  }

  hasLocal(name) { return this.vars.has(name); }

  getVar(name) {
    if (this.vars.has(name)) return this.vars.get(name);
    if (this.opened && this.parent) return this.parent.getVar(name);
    throw new DaCodeRuntimeError(`Name '${name}' is not defined in this container`);
  }

  get(name) { return this.getVar(name).value; }

  set(name, value) {
    if (!this.vars.has(name)) {
      this.define(name, value);
      return;
    }
    const variable = this.vars.get(name);
    if (variable.blocked) throw new DaCodeRuntimeError(`${name} is block and cannot be changed`);
    checkType(value, variable.typeSpec);
    variable.value = value;
  }
}

module.exports = { Environment };
