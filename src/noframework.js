(() => {

class ProxyFactory {
	#all = [];
	#dirty = {};
	#events = new EventTarget();

	constructor() {
	}

	markDirty(d) {
		this.#dirty[d.id] = d;
		if (d) {
			this.events.dispatchEvent(new Event('dirty'));
		}
	}

	clearDirty() {
		const d = this.#dirty;
		this.#dirty = {};
		return d;
	}

	get dirty() { return this.#dirty; }
	get all() { return this.#all.map(x => x.deref()).filter(x => x !== undefined); }
	get events() { return this.#events; }

	create(target) {
		Object.keys(target)
			.filter(p => Array.isArray(target[p]) || (target[p] !== null && typeof(target[p]) === 'object'))
			.forEach(p => target[p] = this.create(target[p]));

		const p = new Proxy(target, {
			get: (o,p) => {
				if (p === '__isProxy') return true;
				return o[p];
			},
			set: (o,p,v) => {
				if (Array.isArray(v) || (v !== null && typeof(v) === 'object'))
					v = this.create(v);
				o[p] = v;
				this.markDirty(o);
				return true;
			},
			deleteProperty: (o,p) => {
				delete o[p];
				this.markDirty(o);
				return true;
			}
		});

		this.#all = this.#all.filter(x => x.deref() !== undefined);
		this.#all.push(new WeakRef(p));
		return p;
	}
}

class IdFactory {
	#gen = 0;

	next() { return (++this.#gen).toString(); }

	withId(x) {
		x.id = this.next();
		return x;
	}
}

class Debouncer {
	#timeout;

	debounce(f) {
		if (this.#timeout)
			return;
		this.#timeout = setTimeout(() => {
			this.#timeout = null;
			try {
				f();
			} catch (e) {
				console.error(e);
				throw e;
			}
		});
	}
};

class DirtyUpdater {
	#selectById = id => document.querySelectorAll(`[data-nf-id="${id}"]`)
	#selectAny = () => document.querySelectorAll(`[data-nf-any]`)
	#template;
	constructor(template) {
		this.#template = template;
	}
	updateFromFactory(proxyFactory) {
		this.update(proxyFactory.clearDirty());
	}
	update(dirty) {
		const before = Date.now();

		const objRefs = Object.keys(dirty)
			.map(id => ({obj: dirty[id], refs: Array.from(this.#selectById(id))}));
		objRefs.push({obj: {id:''}, refs: Array.from(this.#selectAny())});
		const renderer = (n, d) => n.dataRender && n.dataRender || n.getAttribute('data-nf-tpl') && this.#template.compile(n.getAttribute('data-nf-tpl'), d);
		const updateElement = (n, d) => n.textContent = renderer(n, d)(d);
		const updateInput = (n, d) => n.value = renderer(n)(d);
		const updaterFor = (n) => {
			if (n instanceof HTMLInputElement) return d => updateInput(n, d);
			if (n instanceof HTMLElement) return d => updateElement(n, d);
			return null;
		}
		const all = proxies.all;
		objRefs.forEach(objRef => {
			const id = objRef.obj.id;
			const data = objRef.obj;
			if (!data) {
				console.warn(`data not found '${id}'`);
				return;
			}
			objRef.refs.forEach(elm => {
				updaterFor(elm)({all, data});
			});
		});
		const after = Date.now();
		if (after-before > 10)
			console.debug(`Update took ${after-before}ms`);
	}
}

// neat but why is this better than eval?
class Template {
	constructor() {
		this.globals = {};
	}

	static merge(into) {
		Array.from(arguments).slice(1).forEach(next => {
			Object.keys(next).forEach(p => into[p] = next[p]);
		});
		return into;
	}

	compile(template, keysArrayOrObject) {
		const sortedKeys = Object.keys(this.globals).concat(Array.isArray(keysArrayOrObject)?[].concat(keysArrayOrObject):Object.keys(keysArrayOrObject)).sort();
		const stringTemplateBody = `return \`${template.replaceAll('`', '\\`')}\`;`
		function StringTemplate() { return Function.apply(this, [sortedKeys].concat([stringTemplateBody])); }
		const render = new StringTemplate();
		return (data) => {
			const merged = Template.merge({}, this.globals, data);
			return render.apply(null, sortedKeys.map(x => merged[x]));
		};
	}
}

const setup = () => {
	const proxyFactory = new ProxyFactory();
	const debouncer = new Debouncer();
	const template = new Template();
	const updater = new DirtyUpdater(template);
	const idFactory = new IdFactory();
	proxyFactory.events.addEventListener('dirty', () => debouncer.debounce(() => updater.updateFromFactory(proxyFactory)));
	return {
		proxyFactory,
		debouncer,
		updater,
		idFactory,
		template
	};
};

const noframework = {
	ProxyFactory,
	IdFactory,
	Debouncer,
	DirtyUpdater,
	Template,
	setup
};
// export / <script type="module"> dont work without a local webserver
window.noframework = noframework;

})();