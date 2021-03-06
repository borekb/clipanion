const chalk                                = require('chalk');
const fs                                   = require('fs');
const camelCase                            = require('camelcase');
const path                                 = require('path');

const { Command }                          = require('./Command');
const { UsageError }                       = require('./UsageError');
const { getOptionComponent, getUsageLine } = require('./format');
const { parse }                            = require('./parse');

let standardOptions = [ {

    shortName: `h`,
    longName: `help`,

}, {

    shortName: null,
    longName: `clipanion-definitions`,

    hidden: true,

} ];

exports.Clipanion = class Clipanion {

    constructor({configKey = `config`} = {}) {

        this.configKey = configKey;

        this.commands = [];

        this.validator = null;
        this.options = standardOptions.slice();

        this.beforeEachList = [];
        this.afterEachList = [];

        if (this.configKey !== null) {
            this.options.push({
                longName: this.configKey,
                argumentName: `PATH`
            });
        }

    }

    beforeEach(callback) {

        this.beforeEachList.push(callback);

        return this;

    }

    afterEach(callback) {

        this.afterEachList.push(callback);

        return this;

    }

    topLevel(pattern) {

        if (Array.isArray(pattern))
            pattern = pattern.join(` `);

        let definition = parse(pattern);

        if (definition.path.length > 0)
            throw new Error(`The top-level pattern cannot have a command path; use command() instead`);

        if (definition.requiredArguments.length > 0)
            throw new Error(`The top-level pattern cannot have required arguments; use command() instead`);

        if (definition.optionalArguments.length > 0)
            throw new Error(`The top-level pattern cannot have optional arguments; use command() instead`);

        this.options = this.options.concat(definition.options);

        return this;

    }

    validate(validator) {

        this.validator = validator;

        return this;

    }

    directory(startingPath, recursive = true, pattern = /\.js$/) {

        if (typeof IS_WEBPACK !== `undefined`) {

            if (typeof startingPath === `string`)
                throw new Error(`In webpack mode, you must use require.context to provide the directory content yourself; a path isn't enough`);

            for (let entry of startingPath.keys()) {

                let pkg = startingPath(entry);
                let factory = pkg.default || pkg;

                factory(this);

            }

        } else {

            let pathQueue = [ path.resolve(startingPath) ];
            let commandFiles = [];

            while (pathQueue.length > 0) {

                let currentPath = pathQueue.shift();
                let entries = fs.readdirSync(currentPath);

                for (let entry of entries) {

                    let entryPath = `${currentPath}/${entry}`;
                    let stat = fs.lstatSync(entryPath);

                    if (stat.isDirectory() && recursive)
                        pathQueue.push(entryPath);

                    if (stat.isFile() && entry.match(pattern)) {
                        commandFiles.push(entryPath);
                    }

                }

            }

            for (let commandPath of commandFiles) {

                let pkg = require(commandPath);
                let factory = pkg.default || pkg;

                factory(this);

            }

        }

    }

    command(pattern) {

        if (Array.isArray(pattern))
            pattern = pattern.join(` `);

        let definition = parse(pattern);

        let command = new Command(this, definition);
        this.commands.push(command);

        return command;

    }

    error(error, { stream }) {

        if (error && error.isUsageError) {

            stream.write(`${chalk.red.bold(`Error`)}${chalk.bold(`:`)} ${error.message}\n`);

        } else if (error && error.message) {

            let stackIndex = error.stack ? error.stack.search(/\n *at /) : -1;

            if (stackIndex >= 0) {
                stream.write(`${chalk.red.bold(`Error`)}${chalk.bold(`:`)} ${error.message}${error.stack.substr(stackIndex)}\n`);
            } else {
                stream.write(`${chalk.red.bold(`Error`)}${chalk.bold(`:`)} ${error.message}\n`);
            }

        } else {

            stream.write(`${chalk.red.bold(`Error`)}${chalk.bold(`:`)} ${error}\n`);

        }

    }

    usage(argv0, { command = null, error = null, stream = process.stderr } = {}) {

        if (error) {

            this.error(error, { stream });

            stream.write(`\n`);

        }

        if (command) {

            let commandPath = command.path.join(` `);
            let usageLine = getUsageLine(command);

            if (!error) {

                if (command.description) {

                    let capitalized = command.description.replace(/^[a-z]/, $0 => $0.toUpperCase());

                    stream.write(capitalized);
                    stream.write(`\n`);

                }

                if (command.details || command.examples.length > 0) {

                    stream.write(`${chalk.bold(`Usage:`)}\n`);
                    stream.write(`\n`);
                    stream.write(`${argv0 || ``} ${commandPath} ${usageLine}\n`.replace(/ +/g, ` `).replace(/^ +| +$/g, ``));

                } else {

                    stream.write(`${chalk.bold(`Usage:`)} ${argv0 || ``} ${commandPath} ${usageLine}\n`.replace(/ +/g, ` `).replace(/^ +| +$/g, ``));

                }

                if (command.details) {

                    stream.write(`\n`);
                    stream.write(`${chalk.bold(`Details:`)}\n`);
                    stream.write(`\n`);

                    stream.write(command.details);

                }

                if (command.examples.length > 0) {

                    stream.write(`\n`);
                    stream.write(`${chalk.bold(`Examples:`)}\n`);

                    for (let {description, example} of command.examples) {
                        stream.write(`\n`);
                        stream.write(description);
                        stream.write(`\n`);
                        stream.write(example.replace(/^/m, `  `));
                    }

                }

            } else {

                stream.write(`${chalk.bold(`Usage:`)} ${argv0 || ``} ${commandPath} ${usageLine}\n`.replace(/ +/g, ` `).replace(/^ +| +$/g, ``));

            }

        } else {

            let globalOptions = getOptionComponent(this.options);

            stream.write(`${chalk.bold(`Usage:`)} ${argv0 || `<binary>`} ${globalOptions} <command>\n`.replace(/ +/g, ` `).replace(/ +$/, ``));

            let commandsByCategories = new Map();
            let maxPathLength = 0;

            for (const command of this.commands) {

                if (command.hiddenCommand || command.path.some(component => component.startsWith(`_`)))
                    continue;

                let categoryCommands = commandsByCategories.get(command.category);

                if (!categoryCommands)
                    commandsByCategories.set(command.category, categoryCommands = []);

                categoryCommands.push(command);

                let thisPathLength = command.path.join(` `).length;

                if (thisPathLength > maxPathLength) {
                    maxPathLength = thisPathLength;
                }

            }

            let categoryNames = Array.from(commandsByCategories.keys()).sort((a, b) => {

                if (a === null)
                    return -1;
                if (b === null)
                    return +1;

                return a.localeCompare(b, `en`, {usage: `sort`, caseFirst: `upper`});

            });

            for (let categoryName of categoryNames) {

                let commands = commandsByCategories.get(categoryName).slice().sort((a, b) => {

                    const aPath = a.path.join(` `);
                    const bPath = b.path.join(` `);

                    return aPath.localeCompare(bPath, `en`, {usage: `sort`, caseFirst: `upper`});

                });

                let header = categoryName !== null ? categoryName.trim() : `Where <command> is one of`;

                stream.write(`\n`);
                stream.write(`${chalk.bold(`${header}:`)}\n`);
                stream.write(`\n`);

                let pad = str => {
                    return `${str}${` `.repeat(maxPathLength - str.length)}`;
                };

                for (let command of commands) {
                    stream.write(`  ${chalk.bold(pad(command.path.join(` `)))}  ${command.description ? command.description.trim() : `undocumented`}\n`);
                }

            }

        }

    }

    definitions({ stream = process.stderr } = {}) {

        let commands = [];

        for (const command of this.commands) {
            if (!command.hiddenCommand) {
                commands.push({
                    path: command.path,
                    category: command.category,
                    usage: getUsageLine(command),
                    description: command.description,
                    details: command.details,
                    examples: command.examples,
                });
            }
        }

        stream.write(JSON.stringify({
            commands,
        }, null, 2));

    }

    check() {

        if (this.commands.filter(command => command.defaultCommand).length > 1)
            throw new Error(`Multiple commands have been flagged as default command`);

        let shortNames = this.options.map(option => option.shortName).filter(name => name);
        let longNames = this.options.map(option => option.longName).filter(name => name);

        let topLevelNames = [].concat(shortNames, longNames);

        if (new Set(topLevelNames).size !== topLevelNames.length)
            throw new Error(`Some top-level parameter names are conflicting together`);

        for (let command of this.commands) {
            command.check(topLevelNames);
        }

    }

    async run(argv0, argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, ... initialEnv } = {}) {

        // Sanity check to make sure that the configuration makes sense
        if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development')
            this.check();

        // This object is the one we'll fill with the parsed options
        let env = { argv0, stdin, stdout, stderr, ... initialEnv };

        // This array will contain the literals that will be forwarded to the command as positional arguments
        let rest = [];

        // We copy the global options from our initial environment into our new one (it's a form of inheritance)
        for (let option of this.options) {

            if (option.longName) {

                if (Object.prototype.hasOwnProperty.call(initialEnv, option.longName)) {
                    env[option.longName] = initialEnv[option.longName];
                }

            } else {

                if (Object.prototype.hasOwnProperty.call(initialEnv, option.shortName)) {
                    env[option.shortName] = initialEnv[option.shortName];
                }

            }

        }

        // This pointer contains the command we'll be using if nothing prevents it
        let selectedCommand = this.commands.find(command => command.defaultCommand);

        // This array is the list of the commands we might still have a chance to end up using
        let candidateCommands = this.commands;

        // This array is the list of the words that make up the selected command name
        let commandPath = [];

        // This array is the list of the words that might end up in a command name
        let commandBuffer = [];

        // True if a command has been locked (cannot be changed anymore), false otherwise
        let isCommandLocked = false;

        let LONG_OPTION = 0;
        let SHORT_OPTION = 1;
        let STOP_OPTION = 2;
        let MALFORMED_OPTION = 3;
        let RAW_STRING = 4;

        let LONG_OPTION_REGEXP = /^--(?:(no|without)-)?([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)(?:(=)(.*))?$/;
        let SHORT_OPTION_REGEXP = /^-([a-zA-Z])(?:=(.*))?(.*)$/;

        function lockCommand() {

            if (isCommandLocked)
                return;

            if (!selectedCommand)
                throw new UsageError(`No commands match the arguments you've providen`);

            // We can save what's left of our command buffer into the argv array that will be providen to the command
            rest = commandBuffer.slice(commandPath.length);

            isCommandLocked = true;

        }

        function getShortOption(short) {

            return options.find(option => {
                return option.shortName === short;
            });

        }

        function getLongOption(long) {

            return options.find(option => {
                return option.longName === long;
            });

        }

        function parseArgument(literal) {

            if (literal === `--`)
                return { type: STOP_OPTION, literal };

            if (literal.startsWith(`--`)) {

                let match = literal.match(LONG_OPTION_REGEXP);

                if (match) {
                    return { type: LONG_OPTION, literal, enabled: !match[1], name: (match[1] === `without` ? `with-` : ``) + match[2], value: match[3] ? match[4] || `` : undefined };
                } else {
                    return { type: MALFORMED_OPTION, literal };
                }

            }

            if (literal.startsWith(`-`)) {

                let match = literal.match(SHORT_OPTION_REGEXP);

                if (match) {
                    return { type: SHORT_OPTION, literal, leading: match[1], value: match[2], rest: match[3] };
                } else {
                    return { type: MALFORMED_OPTION, literal };
                }

            }

            return { type: RAW_STRING, literal };

        }

        try {

            let parsedArgv = argv.map(arg => parseArgument(arg));

            for (let t = 0, T = parsedArgv.length; t < T; ++t) {

                let current = parsedArgv[t];
                let next = parsedArgv[t + 1];

                // If we're currently processing a command that accepts arguments by proxy, we treat all following tokens as raw strings
                if (selectedCommand && selectedCommand.proxyArguments && rest.length >= selectedCommand.requiredArguments.length) {

                    current = {... current};
                    current.type = RAW_STRING;

                    next = {... next};
                    next.type = RAW_STRING;

                }

                switch (current.type) {

                    case MALFORMED_OPTION: {

                        throw new UsageError(`Malformed option "${current.literal}"`);

                    } break;

                    case STOP_OPTION: {

                        lockCommand();

                        for (t = t + 1; t < T; ++t) {
                            rest.push(parsedArgv[t].literal);
                        }

                    } break;

                    case SHORT_OPTION: {

                        let leadingOption = selectedCommand ? selectedCommand.options.find(option => option.shortName === current.leading) : null;

                        if (leadingOption)
                            lockCommand();
                        else
                            leadingOption = this.options.find(option => option.shortName === current.leading);

                        if (!leadingOption)
                            throw new UsageError(`Unknown option "${current.leading}"`);

                        if (leadingOption.argumentName) {

                            let value = current.value || current.rest || undefined;

                            if (!value && next && next.type === RAW_STRING) {
                                value = next.literal;
                                t += 1;
                            }

                            if (value === undefined)
                                throw new UsageError(`Option "${leadingOption.shortName}" cannot be used without argument`);

                            let envName = leadingOption.longName
                                ? camelCase(leadingOption.longName)
                                : leadingOption.shortName;

                            if (Array.isArray(leadingOption.initialValue)) {
                                if (env[envName]) {
                                    env[envName].push(value);
                                } else {
                                    env[envName] = [value];
                                }
                            } else {
                                env[envName] = value;
                            }

                        } else {

                            if (current.value)
                                throw new UsageError(`Option "${leadingOption.shortName}" doesn't expect any argument`);

                            if (!current.rest.match(/^[a-z0-9]*$/))
                                throw new UsageError(`Malformed option list "${current.literal}"`);

                            for (let optionName of [ current.leading, ... current.rest ]) {

                                let option = selectedCommand ? selectedCommand.options.find(option => option.shortName === optionName) : null;

                                if (option)
                                    lockCommand();
                                else
                                    option = this.options.find(option => option.shortName === optionName);

                                if (!option)
                                    throw new UsageError(`Unknown option "${optionName}"`);

                                if (option.argumentName)
                                    throw new UsageError(`Option "${optionName}" cannot be placed in an option list, because it expects an argument`);

                                if (option.maxValue !== undefined) {

                                    if (option.longName) {
                                        env[camelCase(option.longName)] = Math.min((env[camelCase(option.longName)] || option.initialValue) + 1, option.maxValue);
                                    } else {
                                        env[option.shortName] = Math.min((env[option.shortName] || option.initialValue) + 1, option.maxValue);
                                    }

                                } else {

                                    if (option.longName) {
                                        env[camelCase(option.longName)] = !option.initialValue;
                                    } else {
                                        env[option.shortName] = !option.initialValue;
                                    }

                                }

                            }

                        }

                    } break;

                    case LONG_OPTION: {

                        let option = selectedCommand ? selectedCommand.options.find(option => option.longName === current.name) : null;

                        if (option)
                            lockCommand();
                        else
                            option = this.options.find(option => option.longName === current.name);

                        if (!option)
                            throw new UsageError(`Unknown option "${current.name}"`);

                        let value;

                        if (option.argumentName) {

                            let disablePrefix = option.longName.startsWith(`with-`) ? `--without` : `--no`;

                            if (!current.enabled && current.value !== undefined)
                                throw new UsageError(`Option "${option.longName}" cannot have an argument when used with ${disablePrefix}`);

                            if (current.enabled) {

                                if (current.value !== undefined) {
                                    value = current.value;
                                } else if (next && next.type === RAW_STRING) {
                                    value = next.literal;
                                    t += 1;
                                } else {
                                    throw new UsageError(`Option "${option.longName}" cannot be used without argument. Use "${disablePrefix}-${option.longName}" instead`);
                                }

                            } else {

                                value = null;

                            }

                        } else {

                            if (current.value !== undefined)
                                throw new UsageError(`Option "${option.name}" doesn't expect any argument`);

                            if (current.enabled) {
                                value = true;
                            } else {
                                value = false;
                            }

                        }

                        let envName = option.longName
                            ? camelCase(option.longName)
                            : option.shortName;

                        if (Array.isArray(option.initialValue)) {
                            if (env[envName]) {
                                env[envName].push(value);
                            } else {
                                env[envName] = [value];
                            }
                        } else {
                            env[envName] = value;
                        }

                    } break;

                    case RAW_STRING: {

                        if (!isCommandLocked) {

                            let nextCandidates = candidateCommands.filter(command => command.path[commandBuffer.length] === current.literal);

                            commandBuffer.push(current.literal);

                            let nextSelectedCommand = nextCandidates.find(command => command.path.length === commandBuffer.length);

                            if (nextSelectedCommand) {
                                selectedCommand = nextSelectedCommand;
                                commandPath = commandBuffer;
                            }

                            candidateCommands = nextCandidates.filter(candidate => candidate !== nextSelectedCommand);

                            // If there's absolutely no other command we can switch to, then we can lock the current one right away, so that we can start parsing its options
                            if (candidateCommands.length === 0) {

                                lockCommand();

                            }

                        } else {

                            rest.push(current.literal);

                        }

                    } break;

                }

            }

            lockCommand();

            if (env.help) {

                if (commandPath.length > 0)
                    this.usage(argv0, { command: selectedCommand, stream: stdout });
                else
                    this.usage(argv0, { stream: stdout });

                return 0;

            }

            if (env.clipanionDefinitions) {

                this.definitions({ stream: stdout });

                return 0;

            }

            for (let name of selectedCommand.requiredArguments) {

                if (rest.length === 0)
                    throw new UsageError(`Missing required argument "${name}"`);

                env[camelCase(name)] = rest.shift();

            }

            for (let name of selectedCommand.optionalArguments) {

                if (rest.length === 0)
                    break;

                env[camelCase(name)] = rest.shift();

            }

            if (selectedCommand.spread)
                env[camelCase(selectedCommand.spread)] = rest;

            else if (rest.length > 0)
                throw new UsageError(`Too many arguments`);

            for (let option of [ ... selectedCommand.options, ... this.options ]) {

                let envName = option.longName
                    ? camelCase(option.longName)
                    : option.shortName;

                if (Object.prototype.hasOwnProperty.call(env, envName))
                    continue;

                env[envName] = option.initialValue;

            }

            if (this.configKey !== null && typeof env[this.configKey] !== `undefined`) {

                let configOptions = JSON.parse(fs.readFileSync(env[this.configKey], `utf8`));

                for (let name of Object.keys(configOptions)) {

                    let option = selectedCommand.options.find(option => option.longName === optionName);

                    if (!option)
                        option = this.options.find(option => option.longName === optionName);

                    if (!option)
                        continue;

                    if (configOptions[name] === undefined)
                        continue;

                    if (option.argumentName) {

                        if (typeof configOptions[name] === `string` || configOptions[name] === null) {
                            env[name] = configOptions[name];
                        } else {
                            throw new UsageError(`Option "${name}" must be a string, null, or undefined`);
                        }

                    } else {

                        if (option.maxValue !== undefined) {

                            if (Number.isInteger(configOptions[name])) {
                                env[name] = Math.max(0, Math.min(Number(configOptions[name]), option.maxValue));
                            } else {
                                throw new UsageError(`Option "${name}" must be a number or undefined`);
                            }

                        } else {

                            if (typeof configOptions[name] === `boolean`) {
                                env[name] = configOptions[name];
                            } else {
                                throw new UsageError(`Option "${name}" must be a boolean or undefined`);
                            }

                        }

                    }

                }

            }

            if (this.validator || selectedCommand.validator) {

                let schema = this.validator && selectedCommand.validator
                    ? this.validator.concat(selectedCommand.validator)
                    : this.validator || selectedCommand.validator;

                try {

                    env = await schema.validate(env);

                } catch (error) {

                    if (error && error.name === `ValidationError`) {

                        if (error.errors.length > 1) {
                            throw new UsageError(`Validation failed because ${error.errors.slice(0, -1).join(`, `)}, and ${error.errors[error.errors.length - 1]}`);
                        } else {
                            throw new UsageError(`Validation failed because ${error.errors[0]}`);
                        }

                    } else {

                        throw error;

                    }

                }

            }

            for (let beforeEach of this.beforeEachList)
                await beforeEach(env);

            let result = await selectedCommand.run(env);

            for (let afterEach of this.afterEachList)
                await afterEach(env, result);

            return result;

        } catch (error) {

            if (error && error.isUsageError) {

                this.usage(argv0, { command: selectedCommand, error, stream: stderr });

                return 1;

            } else {

                throw error;

            }

        }

        return undefined;

    }

    async runExit(argv0, argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, ... rest } = {}) {

        try {

            process.exitCode = await this.run(argv0, argv, { stdin, stdout, stderr, ... rest });

        } catch (error) {

            this.error(error, { stream: stderr });

            process.exitCode = 1;

        }

    }

};
