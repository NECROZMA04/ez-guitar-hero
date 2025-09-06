import "./style.css";

import {
    concatMap,
    delay,
    endWith,
    from,
    fromEvent,
    groupBy,
    GroupedObservable,
    interval,
    merge,
    mergeMap,
    Observable,
    of,
    startWith,
    toArray,
    withLatestFrom,
} from "rxjs";

import { map, filter, scan } from "rxjs/operators";
import * as Tone from "tone";
import { SampleLibrary } from "./tonejs-instruments";
import { RNG } from "./util.ts";

/** Constants */

const CanvasDimensions = {
    WIDTH: 200,
    HEIGHT: 400,
} as const;

const GameSettings = {
    INCREMENT: 1,
    RATE: 7,
    SONG: "RockinRobin",
    THRESHOLD: 40,
    LAST_ROW: 350,
} as const;

const NoteAttributes = {
    RADIUS: 0.07 * CanvasDimensions.WIDTH,
    TAIL_WIDTH: 20,
};

/** User input */

type KeyboardKey = "KeyQ" | "KeyW" | "KeyE" | "KeyR";

type KeyboardEventType = "keydown" | "keyup" | "keypress";

type HTMLElementOrNull = HTMLElement | null;

/** State processing */

type GameState = Readonly<{
    isGameOver: boolean;
    allNotesFinished: boolean;
    tickCount: number;
    randomSeed: number;
    notesPlayed: number;
    points: number;
    activeNotes: ReadonlyArray<MusicalNote>;
    expiredNotes: ReadonlyArray<MusicalNote>;
    readyNotes: ReadonlyArray<MusicalNote>;
}>;

const defaultState: GameState = {
    isGameOver: false,
    allNotesFinished: false,
    tickCount: 0,
    randomSeed: RNG.hash(3847589), // Random seed
    notesPlayed: 0,
    points: 0,
    activeNotes: [],
    expiredNotes: [],
    readyNotes: [],
} as const;

// Column Enums
const ColorColumn = Object.freeze({
    GREEN: 0,
    RED: 1,
    BLUE: 2,
    YELLOW: 3,
});

type TailInfo = Readonly<{
    start: number;
    end: number;
    inactive: boolean;
}>;

type MusicalNote = Readonly<{
    id: number;
    visible: boolean;
    yPos: number;
    column: number;
    instrument: string;
    volume: number;
    pitch: number;
    startTime: number;
    endTime: number;
    tail: TailInfo | undefined;
}>;

type ScheduledNotes = Readonly<{
    delay: number;
    startTime: number | null;
    group: MusicalNote[];
}>;

/**
 * Advances the game state by one tick.
 *
 * @param state Current game state
 * @returns Updated game state
 */
const advanceTick = (state: GameState): GameState => {
    type NoteAndSound = Readonly<[MusicalNote | null, MusicalNote | null]>;

    const updateNoteYPos =
        (increment: number) =>
        (bottom: number) =>
        (note: MusicalNote): NoteAndSound => {
            const newY = note.yPos + increment;
            const adjustTail = (tail: TailInfo, visible: boolean): TailInfo => {
                const newStart = tail.start + increment;
                const newEnd = visible ? tail.end + increment : bottom;
                const inactive = visible ? false : tail.inactive;
                return { start: newStart, end: newEnd, inactive } as TailInfo;
            };

            if (note.tail) {
                const updatedTail: TailInfo = adjustTail(
                    note.tail,
                    note.visible,
                ) as TailInfo;

                const updatedNote: MusicalNote = {
                    ...note,
                    yPos: newY,
                    tail: updatedTail,
                } as MusicalNote;

                if (note.visible) {
                    if (updatedTail.end === bottom) {
                        return (
                            updatedTail.start < bottom
                                ? [
                                      {
                                          ...updatedNote,
                                          visible: false,
                                          tail: {
                                              ...updatedTail,
                                              inactive: true,
                                          } as TailInfo,
                                      },
                                      null,
                                  ]
                                : [null, null]
                        ) as NoteAndSound;
                    }
                    return (
                        updatedTail.start < bottom
                            ? [updatedNote, null]
                            : [null, null]
                    ) as NoteAndSound;
                } else {
                    if (newY === bottom) {
                        return [updatedNote, updatedNote] as NoteAndSound;
                    }
                    return (
                        updatedTail.start < bottom
                            ? [updatedNote, null]
                            : [null, null]
                    ) as NoteAndSound;
                }
            } else if (newY <= bottom) {
                if (note.visible) {
                    if (newY < bottom) {
                        return [{ ...note, yPos: newY }, null] as NoteAndSound;
                    } else if (newY === bottom) {
                        return [null, null] as NoteAndSound;
                    }
                } else {
                    if (newY < bottom) {
                        return [{ ...note, yPos: newY }, null] as NoteAndSound;
                    } else if (newY === bottom) {
                        return [null, { ...note, yPos: newY }] as NoteAndSound;
                    }
                }
            }
            return [null, null] as NoteAndSound;
        };

    const calcPositionForGame = updateNoteYPos(GameSettings.INCREMENT)(
        GameSettings.LAST_ROW,
    );

    type AccumulatedNotes = Readonly<{
        newActiveNotes: ReadonlyArray<MusicalNote>;
        newReadyNotes: ReadonlyArray<MusicalNote>;
    }>;

    const initialAccumulatedNotes: AccumulatedNotes = {
        newActiveNotes: [],
        newReadyNotes: [],
    };

    const { newActiveNotes, newReadyNotes }: AccumulatedNotes =
        state.activeNotes.reduce((acc: AccumulatedNotes, note: MusicalNote) => {
            const [updatedNote, readyNote] = calcPositionForGame(note);
            return {
                newActiveNotes: updatedNote
                    ? [...acc.newActiveNotes, updatedNote]
                    : acc.newActiveNotes,
                newReadyNotes: readyNote
                    ? [...acc.newReadyNotes, readyNote]
                    : acc.newReadyNotes,
            } as AccumulatedNotes;
        }, initialAccumulatedNotes);

    const isNoteAtBottom = (note: MusicalNote): boolean =>
        note.yPos + 1 === GameSettings.LAST_ROW && note.visible;

    const updatedState: GameState = {
        ...state,
        isGameOver:
            state.allNotesFinished &&
            newActiveNotes.length === 0 &&
            newReadyNotes.length === 0 &&
            state.expiredNotes.length === 0,

        activeNotes: newActiveNotes,

        notesPlayed:
            newActiveNotes.filter(isNoteAtBottom).length === 0
                ? state.notesPlayed
                : state.notesPlayed,

        expiredNotes: [...state.activeNotes],

        readyNotes: newReadyNotes,
    };
    return updatedState;
};

/**
 * Makes an SVG element visible. Moves it to the foreground.
 * @param element SVG element to show
 */
const displayElement = (element: SVGGraphicsElement) => {
    element.setAttribute("visibility", "visible");
    element.parentNode!.appendChild(element);
};

/**
 * Hides an SVG element.
 * @param element SVG element to hide
 */
const concealElement = (element: SVGGraphicsElement) =>
    element.setAttribute("visibility", "hidden");

/**
 * Creates an SVG element with specific attributes.
 *
 * @param namespace Namespace of the SVG element
 * @param elementName Name of the SVGElement
 * @param attributes Attributes to set on the SVG element
 * @returns Created SVG element
 */
const generateSvgElement = (
    namespace: string | null,
    elementName: string,
    attributes: Record<string, string> = {},
) => {
    const element = document.createElementNS(
        namespace,
        elementName,
    ) as SVGElement;
    Object.entries(attributes).forEach(([key, value]) =>
        element.setAttribute(key, value),
    );
    return element;
};

/** Classes for actions in the game */
interface GameAction {
    execute(state: GameState): GameState;
}

// Pure implementation
class ReleaseButton implements GameAction {
    constructor(public readonly column: number) {}
    execute(state: GameState): GameState {
        const updatedPoints: number = state.activeNotes.reduce(
            (acc, note: MusicalNote) => {
                if (
                    note.tail !== undefined &&
                    note.column === this.column &&
                    !note.visible &&
                    !note.tail.inactive
                ) {
                    acc -= 1 + 0.2 * Math.floor(state.notesPlayed / 10);
                }
                return acc;
            },
            state.points,
        );

        const updatedActiveNotes: MusicalNote[] = state.activeNotes.map(
            (note) => {
                if (
                    note.tail !== undefined &&
                    note.column === this.column &&
                    !note.visible &&
                    !note.tail.inactive
                ) {
                    return {
                        ...note,
                        tail: { ...note.tail, inactive: true } as TailInfo,
                    } as MusicalNote;
                }
                return note;
            },
        );

        return {
            ...state,
            activeNotes: updatedActiveNotes,
            points: ~~updatedPoints,
            expiredNotes: [...state.activeNotes],
        } as GameState;
    }
}
// Pure implementation
class PressButton implements GameAction {
    constructor(public readonly column: number) {}
    execute(state: GameState): GameState {
        type ActionAccumulator = Readonly<{
            activated: boolean;
            points: number;
        }>;

        const initialAccumulator: ActionAccumulator = {
            activated: false,
            points: state.points,
        };

        const activationStatus: ActionAccumulator = state.activeNotes.reduce(
            (acc: ActionAccumulator, note: MusicalNote) => {
                if (
                    note.yPos >=
                        GameSettings.LAST_ROW - GameSettings.THRESHOLD &&
                    note.yPos < GameSettings.LAST_ROW &&
                    note.column === this.column &&
                    note.visible
                ) {
                    return {
                        ...acc,
                        activated: true,
                        points:
                            acc.points + (1 + 0.2 * ~~(state.notesPlayed / 10)),
                    };
                }
                return acc;
            },
            initialAccumulator,
        );

        // Update notes and their visibility if activated
        const updatedActiveNotes: MusicalNote[] = state.activeNotes.map(
            (note) => {
                if (
                    note.yPos >=
                        GameSettings.LAST_ROW - GameSettings.THRESHOLD &&
                    note.yPos < GameSettings.LAST_ROW &&
                    note.column === this.column &&
                    note.visible
                ) {
                    return { ...note, visible: false } as MusicalNote;
                }
                return note;
            },
        );

        const samples: ReadonlyArray<string> = [
            "piano",
            "violin",
            "flute",
            "saxophone",
            "trumpet",
            "bass-electric",
        ] as ReadonlyArray<string>;

        const incorrectNote: MusicalNote = {
            instrument:
                samples[~~(RNG.scale(state.randomSeed) * samples.length)],
            volume: ~~(RNG.scale(state.randomSeed) * 90), // you can change 90  to 128, the sound is just too loud
            pitch: ~~(RNG.scale(state.randomSeed) * 70),
            startTime: 0.0,
            endTime: ~~(RNG.scale(state.randomSeed) * 500),
        } as MusicalNote;

        const checkWrongPress: boolean =
            !activationStatus.activated &&
            updatedActiveNotes.filter(
                (note: MusicalNote) =>
                    note.column === this.column &&
                    !note.visible &&
                    note.tail !== undefined,
            ).length === 0;

        return {
            ...state,
            notesPlayed: activationStatus.activated
                ? state.notesPlayed + 1
                : state.notesPlayed, // Update note count if activated
            activeNotes: updatedActiveNotes,
            randomSeed: RNG.hash(state.randomSeed),
            expiredNotes: [...state.activeNotes],
            points: ~~activationStatus.points,
            readyNotes: checkWrongPress
                ? state.readyNotes.concat(incorrectNote)
                : state.readyNotes,
        } as GameState;
    }
}

/** Ticking The main game engine */
// Pure implementation
class GameTick implements GameAction {
    execute(state: GameState): GameState {
        const newState: GameState = advanceTick(state);
        return {
            ...newState,
            tickCount: state.tickCount + 1,
        } as GameState;
    }
}
// Pure implementation
class EndGame implements GameAction {
    execute(state: GameState): GameState {
        return advanceTick({ ...state, allNotesFinished: true });
    }
}
// Pure implementation
class AddNextNote implements GameAction {
    constructor(public readonly activeNotes: MusicalNote[]) {}
    execute(state: GameState): GameState {
        const notesWithTail = this.activeNotes.map((note: MusicalNote) => {
            const duration = note.endTime - note.startTime;
            if (note.visible && duration > 1000) {
                const tailLength = duration / GameSettings.RATE; // Calculate tail length based on duration
                return {
                    ...note,
                    tail: {
                        start: note.yPos - tailLength,
                        end: note.yPos,
                    } as TailInfo,
                } as MusicalNote;
            } else {
                return {
                    ...note,
                    tail: undefined,
                } as MusicalNote;
            }
        });
        return advanceTick({
            ...state,
            randomSeed: RNG.hash(state.randomSeed),
            activeNotes: state.activeNotes.concat(notesWithTail),
        });
    }
}
// Pure implementation
function highlightKeys() {
    function highlightKey(key: KeyboardKey) {
        const keyElement = document.getElementById(key);
        if (!keyElement) return;

        const keydown$ = fromEvent<KeyboardEvent>(document, "keydown").pipe(
            filter(({ code }) => code === key),
        );

        const keyup$ = fromEvent<KeyboardEvent>(document, "keyup").pipe(
            filter(({ code }) => code === key),
        );

        keydown$.subscribe(() => keyElement.classList.add("highlight"));
        keyup$.subscribe(() => keyElement.classList.remove("highlight"));
    }
    highlightKey("KeyQ");
    highlightKey("KeyW");
    highlightKey("KeyE");
    highlightKey("KeyR");
}

// Function used in subscribe
const executeNotes = (
    state: GameState,
    samples: { [key: string]: Tone.Sampler },
) => {
    if (state.readyNotes.length > 0) {
        state.readyNotes.forEach((note: MusicalNote) => {
            const frequency = Tone.Frequency(note.pitch, "midi").toNote();
            if (note.tail !== undefined) {
                samples[note.instrument].triggerAttack(
                    frequency,
                    undefined,
                    note.volume / 127,
                );

                setTimeout(() => {
                    samples[note.instrument].triggerRelease(frequency);
                }, note.endTime - note.startTime);
            } else {
                samples[note.instrument].triggerAttackRelease(
                    frequency,
                    (note.endTime - note.startTime) / 1000,
                    undefined,
                    note.volume / 127,
                );
            }
        });
    }
};

// Function used in subscribe
const muteNotes = (
    state: GameState,
    samples: { [key: string]: Tone.Sampler },
) => {
    state.activeNotes
        .filter(
            (note: MusicalNote) =>
                !note.visible && note.tail !== undefined && note.tail.inactive,
        )
        .forEach((note: MusicalNote) => {
            samples[note.instrument].triggerRelease(
                Tone.Frequency(note.pitch, "midi").toNote(),
            );
        });
};

// Function used in subscribe
function drawOuterCircle(
    svgNamespaceURI: string | null,
    note: MusicalNote,
    svg: SVGGraphicsElement & HTMLElement,
    hasTail: boolean,
) {
    const outerCircle = generateSvgElement(svgNamespaceURI, "circle", {
        id: String(note.id),
        r: `${NoteAttributes.RADIUS}`,
        cx: `${(note.column + 1) * 20}%`,
        cy: String(hasTail ? 350 : note.yPos),
        style: `fill: url(#${
            hasTail && note.tail!.inactive
                ? "grey"
                : ["green", "red", "blue", "yellow"][note.column]
        }Gradient);`,
        class: "shadow",
    });

    svg.appendChild(outerCircle);
}

/**
 * Main function for starting the game.
 * Handles the game loop and rendering.
 */
export function main(
    csvData: string,
    samples: { [key: string]: Tone.Sampler },
) {
    const svg = document.querySelector("#svgCanvas") as SVGGraphicsElement &
        HTMLElement;
    const gameOverScreen = document.querySelector(
        "#gameOver",
    ) as SVGGraphicsElement & HTMLElement;

    const highScoreDisplay = document.querySelector(
        "#highScoreText",
    ) as HTMLElement;

    const savedHighScore = localStorage.getItem("highScore");
    highScoreDisplay.textContent =
        savedHighScore !== null ? String(parseInt(savedHighScore, 10)) : "0";

    svg.setAttribute("height", `${CanvasDimensions.HEIGHT}`);
    svg.setAttribute("width", `${CanvasDimensions.WIDTH}`);

    // Display elements
    const multiplierDisplay = document.querySelector(
            "#multiplierText",
        ) as HTMLElement,
        scoreDisplay = document.querySelector("#scoreText") as HTMLElement,
        /** User input */
        fromKeyDown$ = (keyCode: KeyboardKey) =>
            fromEvent<KeyboardEvent>(document, "keydown").pipe(
                filter(({ code }) => code === keyCode),
            ),
        fromKeyUp$ = (keyCode: KeyboardKey) =>
            fromEvent<KeyboardEvent>(document, "keyup").pipe(
                filter(({ code }) => code === keyCode),
            ),
        filterIfNotPaused =
            <T>(pauseKey$: Observable<boolean>) =>
            (source$: Observable<T>) =>
                source$.pipe(
                    withLatestFrom(pauseKey$),
                    filter(([_, isPaused]) => !isPaused),
                ),
        determineColumn: (pitch: number) => number = (pitch) => pitch % 4,
        /** Utility functions to parse CSV data */
        parseCSV$ = (csvData: string): Observable<MusicalNote> =>
            from(csvData.split("\n")).pipe(
                map((item: string) => item.split(",")),
                filter(
                    (items: string[]) =>
                        items[0] === "True" || items[0] === "False",
                ),
                scan(
                    (acc: MusicalNote, parts: string[]) =>
                        ({
                            id: acc.id + 1,
                            column: determineColumn(parseInt(parts[3])),
                            yPos: 0,
                            visible: parts[0] === "True",
                            instrument: parts[1],
                            volume: parseInt(parts[2]),
                            pitch: parseInt(parts[3]),
                            startTime: parseFloat(parts[4]) * 1000, // Convert start from seconds to milliseconds
                            endTime: parseFloat(parts[5]) * 1000,
                        }) as MusicalNote,
                    {
                        id: 0,
                    } as MusicalNote,
                ),
            ),
        scheduleNotes$ = (
            notes$: Observable<MusicalNote>,
        ): Observable<MusicalNote[]> => {
            return notes$.pipe(
                groupBy((note: MusicalNote) => note.startTime),
                mergeMap((group$: GroupedObservable<number, MusicalNote>) =>
                    group$.pipe(toArray()),
                ),
            );
        },
        pauseSignal$ = fromEvent<KeyboardEvent>(document, "keydown").pipe(
            filter((event) => event.code === "Space"),
            scan((isPaused) => !isPaused, false),
            startWith(false),
        ),
        parseCSV = (csvData: string): MusicalNote[] =>
            csvData
                .split("\n")
                .map((item: string): string[] => item.split(","))
                .filter(
                    (parts: string[]): boolean =>
                        parts[0] === "True" || parts[0] === "False",
                )
                .reduce(
                    (acc: MusicalNote[], parts: string[]): MusicalNote[] => [
                        ...acc,
                        {
                            id: acc.length + 1,
                            column: determineColumn(parseInt(parts[3])),
                            yPos: 0,
                            visible: parts[0] === "True",
                            instrument: parts[1],
                            volume: parseInt(parts[2]),
                            pitch: parseInt(parts[3]),
                            startTime: parseFloat(parts[4]) * 1000, // Convert start from seconds to milliseconds
                            endTime: parseFloat(parts[5]) * 1000,
                        } as MusicalNote,
                    ],
                    [],
                ),
        scheduleNotes = (notes: MusicalNote[]): MusicalNote[][] =>
            Object.values(
                notes.reduce(
                    (
                        groups: Record<number, MusicalNote[]>,
                        note: MusicalNote,
                    ): Record<number, MusicalNote[]> => {
                        const startTime = note.startTime;
                        return {
                            ...groups,
                            [startTime]: [...(groups[startTime] || []), note],
                        };
                    },
                    {},
                ),
            ),
        // HOF, curried function - (used to adjust the initial start time)
        delayNotes$ =
            (notes$: Observable<MusicalNote[]>) =>
            (initialStartTime: number | null = null) =>
                notes$.pipe(
                    scan(
                        (
                            stored: ScheduledNotes,
                            currentNote: MusicalNote[],
                        ) => {
                            return {
                                startTime: currentNote[0].startTime,
                                delay:
                                    stored.startTime === null
                                        ? 0
                                        : currentNote[0].startTime -
                                          stored.startTime,
                                group: currentNote,
                            } as ScheduledNotes;
                        },
                        {
                            startTime: initialStartTime,
                            delay: 0,
                            group: [],
                        } as ScheduledNotes,
                    ),
                    concatMap((scheduledNotes: ScheduledNotes) =>
                        of(scheduledNotes).pipe(
                            delay(scheduledNotes.delay), // Emit after applying the delay
                        ),
                    ),
                );
    /**
     * Updates the view with the current game state.
     *
     * Updates the display on the canvas using the current state.
     *
     * @param state Current game state
     */

    const clearNotes = (state: GameState) => {
        state.expiredNotes.forEach((note: MusicalNote) => {
            const element = document.getElementById(String(note.id));
            if (element) svg.removeChild(element);

            const tailElement = document.getElementById(
                String(note.id) + "-tail",
            );
            if (tailElement) svg.removeChild(tailElement);
        });
    };

    /** Rendering (side effects) */
    const updateView = (state: GameState) => {
            clearNotes(state);

            state.activeNotes.forEach((note: MusicalNote) => {
                if (note.visible) {
                    // Notes not played by user with tail
                    if (note.tail !== undefined) {
                        const tailElementId = `${String(note.id)}-tail`;
                        svg.appendChild(
                            generateSvgElement(svg.namespaceURI, "rect", {
                                id: tailElementId,
                                x: `${(note.column + 1) * 20 - 5}%`,
                                y: String(note.tail.start),
                                width: `${NoteAttributes.TAIL_WIDTH}`,
                                height: `${note.tail.end - note.tail.start}`,
                                rx: "10",
                                ry: "10",
                                style: `fill: url(#${
                                    ["green", "red", "blue", "yellow"][
                                        note.column
                                    ]
                                }Gradient); stroke: none;`,
                                class: "shadow",
                            }),
                        );
                    }

                    // Normal visual notes
                    drawOuterCircle(svg.namespaceURI, note, svg, false);
                }
                // Notes played by user with tail
                else if (note.tail !== undefined) {
                    const tailElementId = `${String(note.id)}-tail`;
                    svg.appendChild(
                        generateSvgElement(svg.namespaceURI, "rect", {
                            id: tailElementId,
                            x: `${(note.column + 1) * 20 - 5}%`,
                            y: String(note.tail.start),
                            width: `${NoteAttributes.TAIL_WIDTH}`,
                            height: `${note.tail.end - note.tail.start}`,
                            rx: "10",
                            ry: "10",
                            style: note.tail.inactive
                                ? "fill: url(#greyGradient); stroke: none;"
                                : `fill: url(#${
                                      ["green", "red", "blue", "yellow"][
                                          note.column
                                      ]
                                  }Gradient); stroke: none;`,
                            class: "shadow",
                        }),
                    );

                    drawOuterCircle(svg.namespaceURI, note, svg, true);
                }
            });
            scoreDisplay.textContent = String(state.points);
            const currentHighScore = parseInt(
                savedHighScore !== null
                    ? String(parseInt(savedHighScore, 10))
                    : "0",
            );
            const check = state.activeNotes.filter(
                (note: MusicalNote) => !note.visible && note.tail !== undefined,
            );
            if (state.points > currentHighScore && check.length === 0) {
                localStorage.setItem("highScore", String(state.points));
                highScoreDisplay.textContent = String(state.points);
            }
        },
        /**
         * Extracting the notes from the csv data file.
         * */

        notes$ = parseCSV$(csvData),
        scheduledNotes$ = scheduleNotes$(notes$),
        delayedNotes$ = delayNotes$(scheduledNotes$)(null), // put 0 for delaying the start time based on the first note start
        releaseGreen$ = fromKeyUp$("KeyQ").pipe(
            filterIfNotPaused(pauseSignal$),
            map((_) => new ReleaseButton(ColorColumn.GREEN)),
        ),
        releaseRed$ = fromKeyUp$("KeyW").pipe(
            filterIfNotPaused(pauseSignal$),
            map((_) => new ReleaseButton(ColorColumn.RED)),
        ),
        releaseBlue$ = fromKeyUp$("KeyE").pipe(
            filterIfNotPaused(pauseSignal$),
            map((_) => new ReleaseButton(ColorColumn.BLUE)),
        ),
        releaseYellow$ = fromKeyUp$("KeyR").pipe(
            filterIfNotPaused(pauseSignal$),
            map((_) => new ReleaseButton(ColorColumn.YELLOW)),
        ),
        tick$ = interval(GameSettings.RATE).pipe(
            filterIfNotPaused(pauseSignal$),
            map(() => new GameTick()),
        ),
        nextNote$ = delayedNotes$.pipe(
            filterIfNotPaused(pauseSignal$),
            map(([notes, _]) => new AddNextNote(notes.group)),
            endWith(new EndGame()),
        ),
        pressGreen$ = fromKeyDown$("KeyQ").pipe(
            filterIfNotPaused(pauseSignal$),
            map((_) => new PressButton(ColorColumn.GREEN)),
        ),
        pressRed$ = fromKeyDown$("KeyW").pipe(
            filterIfNotPaused(pauseSignal$),
            map((_) => new PressButton(ColorColumn.RED)),
        ),
        pressBlue$ = fromKeyDown$("KeyE").pipe(
            filterIfNotPaused(pauseSignal$),
            map((_) => new PressButton(ColorColumn.BLUE)),
        ),
        pressYellow$ = fromKeyDown$("KeyR").pipe(
            filterIfNotPaused(pauseSignal$),
            map((_) => new PressButton(ColorColumn.YELLOW)),
        );

    const applyGameAction = (state: GameState, action: GameAction) =>
        action.execute(state);
    const gameEngine$ = merge(
        pressGreen$,
        pressRed$,
        pressBlue$,
        pressYellow$, // Pressing the buttons - Designed for both normal notes and the tails
        releaseGreen$,
        releaseRed$,
        releaseBlue$,
        releaseYellow$, // Releasing the buttons - Designed for mostly for the tails
        nextNote$,
        tick$, // Main game ticking and incoming notes generation
    );

    const gameState$: Observable<GameState> = gameEngine$.pipe(
        scan(applyGameAction, defaultState),
    );

    const stopGame$: Observable<MouseEvent> = fromEvent<MouseEvent>(
        document.getElementById("stopButton")!,
        "mousedown",
    );

    const stopGameSubscription = (state: GameState) =>
        stopGame$.subscribe(() => {
            subscription.unsubscribe();
            clearNotes(state);
            multiplierDisplay.textContent = "1x";
            scoreDisplay.textContent = "0";
            concealElement(gameOverScreen);
        });

    const subscription = gameState$.subscribe((state: GameState) => {
        updateView(state);
        executeNotes(state, samples);
        muteNotes(state, samples);

        stopGameSubscription(state);

        if (state.isGameOver) {
            displayElement(gameOverScreen);
            subscription.unsubscribe();
        } else {
            concealElement(gameOverScreen);
        }
    });
}

// The following simply runs your main function on window load.  Make sure to leave it in place.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    const samples = SampleLibrary.load({
        instruments: [
            "bass-electric",
            "violin",
            "piano",
            "trumpet",
            "saxophone",
            "trombone",
            "flute",
        ],
        baseUrl: "samples/",
    });

    const fileInput: HTMLInputElement | null = document.getElementById(
        "csvFileInput",
    ) as HTMLInputElement | null;
    const startButton: HTMLElementOrNull = document.getElementById(
        "startButton",
    ) as HTMLElement | null;
    const stopButton = document.getElementById("stopButton")!;
    const loadingStatus = document.getElementById("loading-status-text");

    const initializeGame = (contents: string) => {
        highlightKeys();

        if (fileInput && startButton) {
            const fileLoad$: Observable<File | null> = fromEvent<Event>(
                fileInput,
                "change",
            ).pipe(
                filter(
                    (_) =>
                        fileInput.files !== null && fileInput.files.length > 0,
                ),
                map((_) => fileInput.files![0]),
                startWith(null),
            );

            const startClick$: Observable<MouseEvent> = fromEvent<MouseEvent>(
                startButton,
                "mousedown",
            );

            const startOperation$ = startClick$.pipe(withLatestFrom(fileLoad$));

            startOperation$.subscribe(([_, file]) => {
                if (file) {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const csvContent = reader.result as string;

                        main(csvContent, samples);
                    };
                    reader.onerror = () => {
                        console.error("Error reading the file");

                        main(contents, samples);
                    };
                    reader.readAsText(file);
                } else {
                    main(contents, samples);
                }
                startButton.setAttribute("disabled", "disabled");
                fileInput.setAttribute("disabled", "disabled");
            });
        } else {
            console.error("File input or start button element not found");
        }
    };

    const resetUI = () => {
        const fileInput = document.getElementById("csvFileInput")!;
        fileInput.removeAttribute("disabled");

        const startButton = document.getElementById("startButton")!;
        startButton.removeAttribute("disabled");
    };

    const stopClick$ = fromEvent(stopButton, "click");
    stopClick$.subscribe(() => {
        if (!stopButton.getAttribute("disabled")) {
            resetUI();
        }
    });

    const { protocol, hostname, port } = new URL(import.meta.url);
    const baseUrl = `${protocol}//${hostname}${port ? `:${port}` : ""}`;

    Tone.ToneAudioBuffer.loaded().then(() => {
        for (const instrument in samples) {
            samples[instrument].toDestination();
            samples[instrument].release = 0.5;
        }

        fetch(`${baseUrl}/assets/${GameSettings.SONG}.csv`)
            .then((response) => response.text())
            .then((text) => initializeGame(text))
            .catch((error) =>
                console.error("Error fetching the CSV file:", error),
            );
    });
}
