/* tilo — layout definitions. Draws nothing, moves nothing. */

const Geometry = require('./lib/geometry');

/*
 * Zones are expressed as fractions [x, y, width, height] within 0..1.
 * They are independent of resolution, monitor and panel height:
 * geometry.resolveZone() handles the conversion to pixels.
 */

/* Direct positions, bound to keyboard shortcuts. */
const QUICK = {
    left:        [0,    0,    0.5,  1   ],
    right:       [0.5,  0,    0.5,  1   ],
    top:         [0,    0,    1,    0.5 ],
    bottom:      [0,    0.5,  1,    0.5 ],
    fill:        [0,    0,    1,    1   ],
    center:      [0.2,  0.15, 0.6,  0.7 ],
    topLeft:     [0,    0,    0.5,  0.5 ],
    topRight:    [0.5,  0,    0.5,  0.5 ],
    bottomLeft:  [0,    0.5,  0.5,  0.5 ],
    bottomRight: [0.5,  0.5,  0.5,  0.5 ]
};

/* Grids offered by the drag-to-top picker (phase 2). */
const LAYOUTS = [
    {
        id: 'halves',
        name: 'Two halves',
        zones: [QUICK.left, QUICK.right]
    },
    {
        id: 'thirds',
        name: 'Three columns',
        zones: [[0, 0, 1/3, 1], [1/3, 0, 1/3, 1], [2/3, 0, 1/3, 1]]
    },
    {
        id: 'main-side',
        name: 'Main plus two',
        zones: [[0, 0, 2/3, 1], [2/3, 0, 1/3, 0.5], [2/3, 0.5, 1/3, 0.5]]
    },
    {
        id: 'quarters',
        name: 'Four quarters',
        zones: [QUICK.topLeft, QUICK.topRight, QUICK.bottomLeft, QUICK.bottomRight]
    },
    {
        id: 'grid-4x3',
        name: 'Grid 4 x 3',
        zones: (() => {
            const out = [];
            for (let row = 0; row < 3; row++)
                for (let col = 0; col < 4; col++)
                    out.push([col / 4, row / 3, 1 / 4, 1 / 3]);
            return out;
        })()
    }
];

function layoutById(id) {
    return LAYOUTS.find(layout => layout.id === id) || null;
}

/* Resolves every zone of a layout into pixel rectangles. */
function resolveLayout(layout, workArea, innerGap, outerGap) {
    return layout.zones.map(zone => Geometry.resolveZone(zone, workArea, innerGap, outerGap));
}

/* Hit test: which zone sits under the pointer? -1 when none. */
function zoneAt(resolvedZones, pointerX, pointerY) {
    for (let i = 0; i < resolvedZones.length; i++) {
        if (Geometry.contains(resolvedZones[i], pointerX, pointerY)) return i;
    }
    return -1;
}

module.exports = { QUICK, LAYOUTS, layoutById, resolveLayout, zoneAt };
