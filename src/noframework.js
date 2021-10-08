(() => {


const Option = x => {
	const o = x == null ? [] : [x]; // == intentional
	o.match = (ifsome, ifnone) => o.length ? ifsome(o[0]) : ifnone();
	return o;
};

class ProxyFactory {
	#all = [];
	#dirty = {};
	#options = {};
	#events = new EventTarget();
	#eventsById = {};

	constructor() {
	}

	markDirty(d) {
		this.#dirty[d.id] = d;
		if (d) {
			this.events.dispatchEvent(Object.assign(new Event('dirty'), {data:d}));
			this.eventsById[d.id]?.events.dispatchEvent(Object.assign(new Event('dirty'), {data:d}));
		}
	}

	clearDirty() {
		const d = this.#dirty;
		this.#dirty = {};
		return d;
	}

	watchDirty(id, listener) {
		this.#eventsById[id] = this.#eventsById[id] || { count: 0, events: new EventTarget() };
		this.#eventsById[id].events.addEventListener('dirty', listener);
		this.#eventsById[id].count++;
		if (!this.#all.find(x => x.deref()?.id === id))
			delete this.#eventsById[id];
	}
	unwatchDirty(id, listener) {
		if (this.#eventsById[id]) {
			this.#eventsById[id].events.removeEventListener('dirty', listener);
			if (--this.#eventsById[id].count < 1)
				delete this.#eventsById[id];
		}
	}

	get dirty() { return this.#dirty; }
	get all() { return this.#all.map(x => x.deref()).filter(x => x !== undefined); }
	get events() { return this.#events; }
	get eventsById() { return this.#eventsById; }
	get options() { return this.#options; }

	create(target) {
		Object.keys(target)
			.filter(p => Array.isArray(target[p]) || (target[p] !== null && typeof(target[p]) === 'object'))
			.forEach(p => target[p] = this.create(target[p]));

		const p = new Proxy(target, {
			get: (o,p) => {
				if (this.#options.meta === true || this.#options.meta?.isProxy === p) return true;
				if (this.#options.meta === true || this.#options.meta?.unProxy === p) return o;
				return o[p];
			},
			set: (o,p,v) => {
				if (Array.isArray(v) || (v !== null && typeof(v) === 'object'))
					v = this.create(v);
				if (v !== o[p]) {
					o[p] = v;
					this.markDirty(o);
				}
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
	constructor(gen) {
		this.#gen = gen || 0;
	}

	next() { return (++this.#gen).toString(); }

	withId(x) {
		x.id = this.next();
		return x;
	}
}

class Debouncer {
	#timeoutId = null;
	delay = 0;

	debounce(f) {
		if (this.#timeoutId !== null) {
			return;
		}
		this.#timeoutId = setTimeout(() => {
			this.#timeoutId = null;
			try {
				f();
			} catch (e) {
				console.error(e);
				throw e;
			}
		}, this.delay);
	}
};

class DirtyUpdater {
	#selectById = id => document.querySelectorAll(`[data-nf-id="${id}"]`);
	#selectAny = () => document.querySelectorAll(`[data-nf-any]`);
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
		const defaultContentRenderer = (n, d) => {
			if (n.getAttribute('data-nf-tpl')) return this.#template.compile(n.getAttribute('data-nf-tpl'), d);
			if (n.dataContent) return n.dataContent(n, d);
		};	
		const customRenderer = (n, _) => n.dataRender && (d => n.dataRender(n, d));
		const noRenderer = (n, _) => (d) => console.log(`No renderer for ${n}`);
		const updateElement = (n, d) => {
			Option(defaultContentRenderer(n, d)).match(
				s => n.textContent = s(d),
				_ => (customRenderer(n, d) || noRenderer(n, d))(d)
			);
		};
		const updateTextInput = (n, d) => {
			Option(defaultContentRenderer(n, d)).match(
				s => n.value = s(d),
				_ => (customRenderer(n, d) || noRenderer(n, d))(d)
			);
		};
		const updateCheckboxInput = (n, d) => {
			Option(defaultContentRenderer(n, d)).match(
				s => n.checked = !!s(d),
				_ => (customRenderer(n, d) || noRenderer(n, d))(d)
			);
		};
		const updaterFor = (n) => {
			switch (n.nodeName) {
				case 'INPUT':
					if (n.type === 'text') return d => updateTextInput(n, d);
					if (n.type === 'number') return d => updateTextInput(n, d);
					if (n.type === 'checkbox') return d => updateCheckboxInput(n, d);
				default:
					return d => updateElement(n, d);
			}
			console.warn(`Unrecognized element ${n}`);
			return () => null;
		};
		objRefs.forEach(objRef => {
			const id = objRef.obj.id;
			const data = objRef.obj;
			if (!data) {
				console.warn(`data not found '${id}'`);
				return;
			}
			objRef.refs.forEach(elm => {
				updaterFor(elm)({data});
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

	compile(template, keysArrayOrObject) {
		const sortedKeys = Object.keys(this.globals).concat(Array.isArray(keysArrayOrObject)?[].concat(keysArrayOrObject):Object.keys(keysArrayOrObject)).sort();
		const stringTemplateBody = `return \`${template.replaceAll('`', '\\`')}\`;`
		function StringTemplate() { return Function.apply(this, [sortedKeys].concat([stringTemplateBody])); }
		const render = new StringTemplate();
		return (data) => {
			const merged = Object.assign({}, this.globals, data);
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
	Option,
	setup
};
// export / <script type="module"> dont work without a local webserver
window.noframework = noframework;

})();