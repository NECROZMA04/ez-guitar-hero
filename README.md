# ez-guitar-hero

A web-based rhythm game inspired by Guitar Hero, built with TypeScript, RxJS, and Tone.js. This project uses a reactive approach for its game loop, processing streams of musical notes from CSV files. Players hit notes in time with the music to score points, increase multipliers, and achieve high scores.

## Features

- **Dynamic Gameplay**: Notes appear from the top of the board and move downwards, synchronized with the music.
- **Four-Lane Track**: A classic four-column game board.
- **Reactive Game Loop**: Built with RxJS Observables to handle game events, note streams, and user input.
- **Audio Processing**: Utilizes Tone.js for playing musical notes from a sample library.
- **Note Tails**: Notes longer than one second have tails, requiring the player to hold the key for the duration of the note.
- **Score Multiplier**: Increases with consecutive successful hits and resets on a miss.
- **Background Music**: Notes not intended for player interaction are played automatically in the background.
- **Scoring System**: Keeps track of hits and misses.
- **Game Over**: The game ends when the song is complete.

## How to Play

- **Keys**: Use the following keys to play the notes in the corresponding columns:
    - Column 1: `Q`
    - Column 2: `W`
    - Column 3: `E`
    - Column 4: `R`
- **Objective**: Press the correct key when a note reaches the bottom row.
- **Long Notes**: For notes with tails, hold the key down for the entire duration of the tail.
- **Scoring**:
    - Hitting a note increases your score.
    - Missing a note resets your score multiplier.
    - For every 10 consecutive notes hit, the multiplier increases by 0.2x.

## Note Specification

The game reads notes from a CSV file with the following columns:

- `user_played`: A boolean (`True`/`False`) indicating if the note is to be played by the user or played in the background.
- `instrument_name`: The instrument used to play the note.
- `velocity`: The volume of the note (0-127), which is mapped to a 0-1 range for the audio library.
- `pitch`: The MIDI value of the note.
- `start (s)`: The time in seconds when the note should start.
- `end (s)`: The time in seconds when the note should end.

## Technical Details

This project is built using a functional reactive programming (FRP) style.

- **RxJS**: The core of the game logic is built around Observables to manage streams of notes, user inputs, and game state changes.
- **Tone.js**: Used for scheduling and playing all audio.
- **TypeScript**: Provides static typing for more robust code.
- **Vite**: A modern frontend build tool that provides a faster and leaner development experience.

## Design and Implementation

For a detailed explanation of the design decisions, functional programming techniques, and implementation, please refer to the `Report.pdf` file included in the project.
