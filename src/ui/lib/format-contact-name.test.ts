import { describe, it, expect } from 'vitest';
import {
  formatContactName,
  getContactSortKey,
  getContactInitials,
  type NameableContact,
} from './format-contact-name.ts';

describe('formatContactName (#1592)', () => {
  const alice: NameableContact = {
    display_name: 'Alice Johnson',
    given_name: 'Alice',
    family_name: 'Johnson',
    middle_name: 'Marie',
    name_prefix: 'Dr.',
    name_suffix: 'PhD',
    contact_kind: 'person',
  };

  describe('default locale (en)', () => {
    it('renders given + family', () => {
      expect(formatContactName(alice, { locale: 'en-US' })).toBe('Alice Marie Johnson');
    });

    it('renders short style', () => {
      expect(formatContactName(alice, { locale: 'en', style: 'short' })).toBe('Alice');
    });

    it('renders formal style with prefix and suffix', () => {
      expect(formatContactName(alice, { locale: 'en', style: 'formal' })).toBe('Dr. Alice Marie Johnson, PhD');
    });
  });

  describe('CJK locales', () => {
    const tanaka: NameableContact = {
      given_name: '太郎',
      family_name: '田中',
      contact_kind: 'person',
    };

    it('ja: family+given without space', () => {
      expect(formatContactName(tanaka, { locale: 'ja-JP' })).toBe('田中太郎');
    });

    it('zh: family+given without space', () => {
      expect(formatContactName(tanaka, { locale: 'zh-CN' })).toBe('田中太郎');
    });

    it('ko: family+given without space', () => {
      expect(formatContactName(tanaka, { locale: 'ko-KR' })).toBe('田中太郎');
    });
  });

  describe('Hungarian locale', () => {
    it('hu: family first with space', () => {
      const contact: NameableContact = { given_name: 'István', family_name: 'Nagy', contact_kind: 'person' };
      expect(formatContactName(contact, { locale: 'hu-HU' })).toBe('Nagy István');
    });
  });

  describe('fallbacks', () => {
    it('returns display_name when no structured fields', () => {
      const contact: NameableContact = { display_name: 'Bob Smith' };
      expect(formatContactName(contact, { locale: 'en' })).toBe('Bob Smith');
    });

    it('returns nickname as last resort', () => {
      const contact: NameableContact = { nickname: 'Bobby' };
      expect(formatContactName(contact, { locale: 'en' })).toBe('Bobby');
    });

    it('returns empty string for null contact', () => {
      expect(formatContactName(null)).toBe('');
    });

    it('returns empty string for undefined contact', () => {
      expect(formatContactName(undefined)).toBe('');
    });
  });

  describe('non-person contacts', () => {
    it('organisation uses display_name', () => {
      const org: NameableContact = {
        display_name: 'Acme Corp',
        given_name: 'Acme',
        family_name: 'Corp',
        contact_kind: 'organisation',
      };
      expect(formatContactName(org, { locale: 'en' })).toBe('Acme Corp');
    });

    it('group uses display_name', () => {
      const group: NameableContact = { display_name: 'Team Alpha', contact_kind: 'group' };
      expect(formatContactName(group, { locale: 'en' })).toBe('Team Alpha');
    });
  });
});

describe('getContactSortKey (#1592)', () => {
  it('uses file_as when set', () => {
    expect(getContactSortKey({ file_as: 'Johnson, Alice', given_name: 'Alice', family_name: 'Johnson' })).toBe('Johnson, Alice');
  });

  it('computes family, given', () => {
    expect(getContactSortKey({ given_name: 'Alice', family_name: 'Johnson' })).toBe('Johnson, Alice');
  });

  it('falls back to display_name', () => {
    expect(getContactSortKey({ display_name: 'Bob' })).toBe('Bob');
  });
});

describe('getContactInitials (#1592)', () => {
  it('uses given + family initials', () => {
    expect(getContactInitials({ given_name: 'Alice', family_name: 'Johnson' })).toBe('AJ');
  });

  it('uses single name initial', () => {
    expect(getContactInitials({ given_name: 'Alice' })).toBe('A');
  });

  it('falls back to display_name', () => {
    expect(getContactInitials({ display_name: 'Alice Johnson' })).toBe('AJ');
  });

  it('handles single word display_name', () => {
    expect(getContactInitials({ display_name: 'Alice' })).toBe('A');
  });

  it('returns empty for null', () => {
    expect(getContactInitials(null)).toBe('');
  });
});
