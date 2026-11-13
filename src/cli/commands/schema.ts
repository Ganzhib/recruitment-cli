import type { Command } from 'commander';

export function describeCommand(command: Command): object {
  return {
    name: command.name(),
    description: command.description(),
    arguments: command.registeredArguments.map((argument) => ({
      name: argument.name(),
      required: argument.required,
      variadic: argument.variadic,
    })),
    options: command.options.map((option) => ({
      flags: option.flags,
      description: option.description,
      required: option.mandatory,
      default: option.defaultValue as unknown,
    })),
    commands: command.commands.map(describeCommand),
  };
}
