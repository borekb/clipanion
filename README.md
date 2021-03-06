<img src="./logo.svg" width="100" />

# Clipanion

> A companion to manage your CLI applications without hassle

[![](https://img.shields.io/npm/v/clipanion.svg)]() [![](https://img.shields.io/npm/l/clipanion.svg)]()

## Installation

```
$> yarn add clipanion
```

## Why

  - Clipanion supports both simple CLI and more complex ones with multiple level of commands (for example `yarn constraints fix`)
  - Clipanion supports proxy commands (for example `yarn run eslint --help`, where `--help` is an option that must be forwarded to `eslint`, not consumed by `yarn run`)
  - Clipanion supports a bunch of option types: boolean, numbered (`-vv`), with arguments (`-x VAL`), arrays (`-x VAL ...`), negations (`--no-optionals` / `--without-openssl`), ...
  - Clipanion finds out the type of the options based on their declaration, and gives them useful default (`false` for booleans, `0` for numbers, ...)
  - Clipanion supports parameter validation for when the default cohercion isn't enough (using [Yup](https://github.com/jquense/yup))
  - Clipanion generates good-looking help pages

Clipanion is used in [Yarn](https://github.com/yarnpkg/berry) with great success.

## Usage

```js
const { clipanion } = require('clipanion');

clipanion
    .topLevel(`[-v,--verbose]`);

clipanion
    .command(`install [--production]`)
    .describe(`Install all packages located into your package.json`)
    .action(() => { /* ... */ });

clipanion
    .command(`add <pkg-name> [... others-pkgs] [-D,--dev] [-P,--peer] [-O,--optional] [-E,--exact] [-T,--tilde]`)
    .describe(`Add a package to your package.json`)
    .action(() => { /* ... */ });

clipanion
    .command(`remove <pkg-name> [... other-pkgs]`)
    .describe(`Remove a package from your package.json`)
    .action(() => { /* ... */ });

clipanion
    .command(`info <pkg-name> [field] [--json]`)
    .describe(`Fetch informations about a package`)
    .action(() => { /* ... */ });

clipanion
    .runExit(process.argv0, process.argv.slice(2));
```

## Standard options

Two options are standard and work without any interaction from your part:

  - `-h,--help` will automatically print the help, also available as `.usage()`
  - `-c,--config` will load a JSON file and use it as input once the command line has been fully read

While `-h` cannot be disabled at this time, `-c` can be toggled off by passing `configKey: null` in the constructor of the `Clipanion` class.

## Patterns

Clipanion automatically deduces command definitions from what we call patterns. A pattern syntax is as follow:

```
command-name <required-arg-1> <required-arg-2> [optional-arg-1] [... spread-name] [-s,--long-name ARGNAME]
```

Note that `command-name` is allowed to have multiple words, in which case the selected command will always be the command with the largest path that match your command line arguments.

The following patterns are all valid:

```
global add <pkg-name>         ; "global add" will be the command name, "pkg-name" will be a required argument
global add [pkg-name]         ; "global add" will be the command name, "pkg-name" will be an optional argument
global add [... args]         ; will accept any number of arguments, potentially zero
global add <first> [... rest] ; will require at least one argument, potentially more
install [-v]                  ; the "v" option will be true or false
install [-vvv]                ; the "v" option will become a counter, from 0 to 3 included
install [-v,--verbose]        ; the "verbose" option will be true (--verbose), or false (--no-verbose), or unspecified
install [--frozen-lockfile?]  ; the "frozenLockfile" option will be true (--frozen-lockfile), false (--no-frozen-lockfile), or null
execute [--output TARGET...]  ; the "output" option will be an array of strings (empty if the option is never set)
download [-u,--url URL]       ; the "url" option will expect a parameter, or will be "null" if --no-url is used
download [--with-ssl]         ; the "ssl" option will be true (--with-ssl), false (--without-ssl), or undefined
command [-vqcarRbudlLkKHpE]   ; declare all those options at once
```

## Environments

Once all the command line arguments have been parsed, an environment object is generated, validated, and passed in the final command action callback. This environment is an object with the following properties:

  - Each key is a parameter name (whether it's a required or optional argument, or an option)
  - Each value is the value associated to the parameter
  - If an option has both a short name and a long name, only the long name will be registered

The environment values have the following properties, excluding any extra validator you may have set:

  - Required arguments are always of type string
  - Optional arguments are always either strings or undefined
  - Short options without arguments are always either true, undefined, or a number
  - Short options with arguments are always either a string or undefined
  - Long options without arguments are always either true, false, or undefined
  - Long options with arguments are always either an array of strings, a string, null, or undefined
  - Combinations of short and long options can be of any type at least one of them accepts

## Default command

Add the `defaultCommand` flag to your command:

```js
const { clipanion, flags } = require('clipanion');

clipanion
    .command(`install [--production]`)
    .describe(`Install all packages located into your package.json`)
    .flag({ defaultCommand: true })
    .action(() => { /* ... */ });
```

## Validation

Clipanion integrates out of the box with the [Yup](https://github.com/jquense/yup) library to validate and transform your data into the specific types that you expect (while also providing your users decent feedback if they enter invalid parameters):

```js
const { clipanion } = require('clipanion');
const yup           = require('yup');

clipanion
    .command(`server [-p,--port PORT]`)
    .describe(`Run a server on the specified port`)
    .validate(yup.object().shape({ port: yup.number().min(1).max(65535).default(8080) }).unknown())
    .action(() => { /* ... */ });

clipanion
    .runExit(process.argv0, process.argv.slice(2));
```

## Command folder

You can split you cli into multiple files by using the `directory()` function, which will load all files matching a specific regex:

```js
clipanion
    .directory(`${__dirname}/commands`, true, /\.js$/);
```

The API mimics `require.context` from Webpack for a good reason - it also accepts its return value:

```js
clipanion
    .directory(require.context(`./commands`, true, /\.js$/));
```

## Daemon plugin

Clipanion ships with an optional and slightly experimental plugin that allows you to run your programs in a daemon mode. When under this mode, Clipanion will add a few predefined commands to your application (such as `start` and `stop`). Running any other one will cause Clipanion to open a connection to the master process and request it to execute the specified command within its own context. The command will then be executed by the master within an adjusted environment (the stdio stream traditionally sent to the Clipanion commands will be special streams that will be forwarded from and to the agent process).

```js
const { makeDaemon } = require('clipanion/daemon');
const { clipanion }  = require('clipanion');

const daemon = makeDaemon(clipanion, {
    port: 4242
});

daemon.command(`_init`)
    .action(() => { /*...*/ });

daemon.command(`hello [--name NAME]`)
    .action(() => { /*...*/ });

daemon
    .run(process.argv0, process.argv.slice(2));
```

Using the `makeDaemon` wrapper will automatically add a few commands to your application:

  - `start` will start a daemon, then will call its `_init` command.
  - `status` will try to reach a daemon, and inform you whether it succeeds or fails.
  - `stop` will make the daemon exit after calling its `_cleanup` command.
  - `restart` will restart the running daemon, with the exact same arguments.

You are expected to implement a few commands by yourself. They will automatically be hidden from the usage:

  - `_init` will be called by `start` and `restart`, and should prepare everything needed for your application to be in valid state. The daemon will start only after this command returns.
  - `_cleanup` will be called by `stop` and `restart`, and should clean everything needed. When it returns, the `start` command will return, usually ending the process.

Last important note: the current daemon implementation **is not secure by default**. Because it only watches localhost it should be impossible for an external attacker to execute requests on your server, however it is possible for any local user (ie people who have an account on the same machine) to send crafted requests to the daemon which will then be executed with the privileges of the user that started the daemon. In order to prevent this, you'll have to implement your own authentication scheme.

## License (MIT)

> **Copyright © 2019 Mael Nison**
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
