'use strict';

const INJECTION_POSITION = Object.freeze({ RELATIVE: 0, IN_CHAT: 1 });
const GENERATION_TYPES = Object.freeze(['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet']);
const WORLD_INFO_POSITION = Object.freeze({
    BEFORE: 0,
    AFTER: 1,
    AUTHORS_NOTE_TOP: 2,
    AUTHORS_NOTE_BOTTOM: 3,
    AT_DEPTH: 4,
    EXAMPLES_TOP: 5,
    EXAMPLES_BOTTOM: 6,
    OUTLET: 7
});
const WORLD_INFO_LOGIC = Object.freeze({ AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 });

module.exports = {
    INJECTION_POSITION,
    GENERATION_TYPES,
    WORLD_INFO_POSITION,
    WORLD_INFO_LOGIC
};
