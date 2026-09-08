/* Injected into Cinnamon via DBus Eval. Results land in global.__tiloTest. */
(function () {
  const Meta = imports.gi.Meta, Mainloop = imports.mainloop;
  const KM = imports.ui.main.keybindingManager;
  const STARTS = [
    { name: 'floating-middle', rect: [600, 400, 700, 500] },
    { name: 'floating-topleft', rect: [0, 0, 500, 400] },
    { name: 'floating-offscreen-ish', rect: [1400, 700, 600, 500] },
    { name: 'maximized', rect: null }
  ];
  const ACTIONS = ['left', 'right', 'top', 'bottom', 'fill', 'center'];

  function cb(name) { let f = null; KM.bindings.forEach(v => { if (v.name === 'tilo-' + name) f = v.callback; }); return f; }
  function expected(a, wa) {
    const F = { left: [0, 0, .5, 1], right: [.5, 0, .5, 1], top: [0, 0, 1, .5],
                bottom: [0, .5, 1, .5], fill: [0, 0, 1, 1], center: [.2, .15, .6, .7] }[a];
    const l = Math.round(wa.x + F[0] * wa.width), t = Math.round(wa.y + F[1] * wa.height);
    return { x: l, y: t,
             width: Math.round(wa.x + (F[0] + F[2]) * wa.width) - l,
             height: Math.round(wa.y + (F[1] + F[3]) * wa.height) - t };
  }

  const wins = global.workspace_manager.get_active_workspace().list_windows()
    .filter(w => w.get_window_type() === Meta.WindowType.NORMAL && !w.is_skip_taskbar());

  const jobs = [];
  wins.forEach(w => STARTS.forEach(s => ACTIONS.forEach(a => jobs.push({ w, s, a }))));

  const out = { done: false, lines: [] };
  global.__tiloTest = out;
  let i = 0;

  function step() {
    if (i >= jobs.length) { out.done = true; return; }
    const { w, s, a } = jobs[i++];
    try {
      w.activate(global.get_current_time());
      if (w.get_maximized()) w.unmaximize(Meta.MaximizeFlags.BOTH);
      if (s.rect) w.move_resize_frame(true, s.rect[0], s.rect[1], s.rect[2], s.rect[3]);
      else w.maximize(Meta.MaximizeFlags.BOTH);
    } catch (e) { /* keep going */ }

    Mainloop.timeout_add(320, () => {
      const f = cb(a);
      if (f) f();
      Mainloop.timeout_add(420, () => {
        const wa = w.get_workspace().get_work_area_for_monitor(w.get_monitor());
        const e = expected(a, wa), r = w.get_frame_rect();
        const dp = Math.max(Math.abs(r.x - e.x), Math.abs(r.y - e.y));
        const ds = Math.max(Math.abs(r.width - e.width), Math.abs(r.height - e.height));
        out.lines.push([w.get_wm_class(), s.name, a,
                        r.width + 'x' + r.height + '+' + r.x + '+' + r.y,
                        e.width + 'x' + e.height + '+' + e.x + '+' + e.y,
                        'dpos=' + dp, 'dsize=' + ds].join('|'));
        step();
        return false;
      });
      return false;
    });
  }
  step();
  return 'started jobs=' + jobs.length;
})();
