import { describe, it, expect } from 'vitest';

describe('Command Palette', () => {
  describe('CommandPalette component', () => {
    it('should export CommandPalette component', async () => {
      const { CommandPalette } = await import('../src/ui/components/command-palette');
      expect(CommandPalette).toBeDefined();
      expect(typeof CommandPalette).toBe('function');
    });
  });

  describe('shadcn Command components', () => {
    it('should export Command component', async () => {
      const { Command } = await import('../src/ui/components/ui/command');
      expect(Command).toBeDefined();
    });

    it('should export CommandDialog component', async () => {
      const { CommandDialog } = await import('../src/ui/components/ui/command');
      expect(CommandDialog).toBeDefined();
    });

    it('should export CommandInput component', async () => {
      const { CommandInput } = await import('../src/ui/components/ui/command');
      expect(CommandInput).toBeDefined();
    });

    it('should export CommandList component', async () => {
      const { CommandList } = await import('../src/ui/components/ui/command');
      expect(CommandList).toBeDefined();
    });

    it('should export CommandEmpty component', async () => {
      const { CommandEmpty } = await import('../src/ui/components/ui/command');
      expect(CommandEmpty).toBeDefined();
    });

    it('should export CommandGroup component', async () => {
      const { CommandGroup } = await import('../src/ui/components/ui/command');
      expect(CommandGroup).toBeDefined();
    });

    it('should export CommandItem component', async () => {
      const { CommandItem } = await import('../src/ui/components/ui/command');
      expect(CommandItem).toBeDefined();
    });

    it('should export CommandShortcut component', async () => {
      const { CommandShortcut } = await import('../src/ui/components/ui/command');
      expect(CommandShortcut).toBeDefined();
    });

    it('should export CommandSeparator component', async () => {
      const { CommandSeparator } = await import('../src/ui/components/ui/command');
      expect(CommandSeparator).toBeDefined();
    });
  });

  describe('Dialog components', () => {
    it('should export Dialog component', async () => {
      const { Dialog } = await import('../src/ui/components/ui/dialog');
      expect(Dialog).toBeDefined();
    });

    it('should export DialogContent component', async () => {
      const { DialogContent } = await import('../src/ui/components/ui/dialog');
      expect(DialogContent).toBeDefined();
    });
  });
});
