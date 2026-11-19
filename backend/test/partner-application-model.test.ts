import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { DeliveryMode, PARTNER_APPLICATION_STATUSES } from '@thehomez/shared-types';
import {
  PartnerApplicationModel,
  PartnerModel,
  ServiceAreaModel,
  UserModel,
} from '../src/models/index.js';

describe('Stage C-11.2A: Partner Application & Guard Fields Data Foundation', () => {
  describe('1. PartnerApplicationModel Schema & Validations', () => {
    it('accepts each of the six approved PartnerApplicationStatus values', () => {
      expect(PARTNER_APPLICATION_STATUSES).toEqual([
        'DRAFT',
        'SUBMITTED',
        'UNDER_REVIEW',
        'APPROVED',
        'REJECTED',
        'WITHDRAWN',
      ]);

      for (const status of PARTNER_APPLICATION_STATUSES) {
        const app = new PartnerApplicationModel({
          businessName: `Test Vendor ${status}`,
          phone: '+919876543210',
          initialUser: {
            contactName: 'Contact Person',
            phone: '+919876543210',
          },
          status,
        });

        const validationError = app.validateSync();
        expect(validationError, `Status "${status}" should be valid`).toBeUndefined();
        expect(app.status).toBe(status);
      }
    });

    it('rejects unapproved or speculative application statuses', () => {
      const invalidStatuses = [
        'ACTIVE',
        'PENDING_VERIFICATION',
        'IN_PROGRESS',
        'REAPPLIED',
        'CLOSED',
        'SUBMIT',
      ];

      for (const badStatus of invalidStatuses) {
        const app = new PartnerApplicationModel({
          businessName: 'Invalid Status Vendor',
          phone: '+919876543210',
          initialUser: {
            contactName: 'Contact Person',
            phone: '+919876543210',
          },
          status: badStatus as unknown as (typeof PARTNER_APPLICATION_STATUSES)[number],
        });

        const validationError = app.validateSync();
        expect(validationError).toBeDefined();
        expect(validationError?.errors.status).toBeDefined();
      }
    });

    it('validates mandatory required fields and rejects empty document', () => {
      const emptyApp = new PartnerApplicationModel({});
      const error = emptyApp.validateSync();

      expect(error).toBeDefined();
      expect(error?.errors.businessName).toBeDefined();
      expect(error?.errors.phone).toBeDefined();
      expect(error?.errors.initialUser).toBeDefined();

      const emptyInitialUserApp = new PartnerApplicationModel({
        businessName: 'Test Business',
        phone: '+919876543210',
        initialUser: {} as unknown as { contactName: string; phone: string },
      });
      const nestedError = emptyInitialUserApp.validateSync();
      expect(nestedError?.errors['initialUser.contactName']).toBeDefined();
      expect(nestedError?.errors['initialUser.phone']).toBeDefined();
    });

    it('validates E.164 phone format on business phone and initial user phone', () => {
      const invalidPhoneApp = new PartnerApplicationModel({
        businessName: 'Invalid Phone Vendor',
        phone: '09876543210', // Missing + country code
        initialUser: {
          contactName: 'Contact Person',
          phone: '9876543210', // Not E.164
        },
      });

      const error = invalidPhoneApp.validateSync();
      expect(error).toBeDefined();
      expect(error?.errors.phone).toBeDefined();
      expect(error?.errors['initialUser.phone']).toBeDefined();
    });

    it('allows valid optional fields and applies default values', () => {
      const previousAppId = new mongoose.Types.ObjectId();
      const staffId = new mongoose.Types.ObjectId();
      const serviceAreaId = new mongoose.Types.ObjectId();

      const app = new PartnerApplicationModel({
        businessName: 'Complete Optional Vendor',
        legalName: 'Complete Optional Materials LLP',
        phone: '+919876543210',
        email: 'info@optionalvendor.com',
        deliveryMode: DeliveryMode.PLATFORM_MANAGED,
        serviceAreaIds: [serviceAreaId],
        metadata: {
          pan: 'ABCDE1234F',
          gstin: '29ABCDE1234F1Z5',
          tradeLicense: 'TL-889900',
        },
        initialUser: {
          contactName: 'Naveen Kumar',
          phone: '+919876543210',
          email: 'naveen@optionalvendor.com',
        },
        previousApplicationId: previousAppId,
        assignedStaffUserId: staffId,
      });

      const error = app.validateSync();
      expect(error).toBeUndefined();
      expect(app.status).toBe('SUBMITTED'); // Default status
      expect(app.deliveryMode).toBe(DeliveryMode.PLATFORM_MANAGED);
      expect(app.legalName).toBe('Complete Optional Materials LLP');
      expect(app.email).toBe('info@optionalvendor.com');
      expect(app.previousApplicationId).toEqual(previousAppId);
      expect(app.assignedStaffUserId).toEqual(staffId);
      expect(app.auditHistory).toEqual([]);
    });

    it('validates previousApplicationId schema reference type', () => {
      const previousAppId = new mongoose.Types.ObjectId();
      const app = new PartnerApplicationModel({
        businessName: 'Reapplication Vendor',
        phone: '+919876543210',
        initialUser: {
          contactName: 'Contact Person',
          phone: '+919876543210',
        },
        previousApplicationId: previousAppId,
      });

      expect(app.previousApplicationId).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(app.previousApplicationId?.toString()).toBe(previousAppId.toString());
    });

    it('validates embedded auditHistory subdocuments and required audit fields', () => {
      const staffId = new mongoose.Types.ObjectId();
      const app = new PartnerApplicationModel({
        businessName: 'Audited Vendor',
        phone: '+919876543210',
        initialUser: {
          contactName: 'Contact Person',
          phone: '+919876543210',
        },
        auditHistory: [
          {
            action: 'APPLICATION_SUBMITTED',
            performedBy: staffId,
            newStatus: 'SUBMITTED',
            reason: 'Initial staff onboarding intake',
          },
          {
            action: 'APPLICATION_UNDER_REVIEW',
            performedBy: staffId,
            previousStatus: 'SUBMITTED',
            newStatus: 'UNDER_REVIEW',
            reason: 'Initiating compliance inspection',
          },
        ],
      });

      const error = app.validateSync();
      expect(error).toBeUndefined();
      expect(app.auditHistory.length).toBe(2);
      expect(app.auditHistory[0]!.action).toBe('APPLICATION_SUBMITTED');
      expect(app.auditHistory[0]!.performedBy).toEqual(staffId);
      expect(app.auditHistory[0]!.timestamp).toBeInstanceOf(Date);
      expect(app.auditHistory[1]!.newStatus).toBe('UNDER_REVIEW');
    });

    it('rejects invalid auditHistory entry missing required fields', () => {
      const app = new PartnerApplicationModel({
        businessName: 'Invalid Audit Vendor',
        phone: '+919876543210',
        initialUser: {
          contactName: 'Contact Person',
          phone: '+919876543210',
        },
        auditHistory: [
          {
            // Missing action and performedBy
            reason: 'Missing fields',
          } as unknown as mongoose.Types.Subdocument,
        ],
      });

      const error = app.validateSync();
      expect(error).toBeDefined();
      expect(error?.errors['auditHistory.0.action']).toBeDefined();
      expect(error?.errors['auditHistory.0.performedBy']).toBeDefined();
    });

    it('declares approved indexes and strictly asserts NO unique index on phone or email', () => {
      const indexes = PartnerApplicationModel.schema.indexes();

      // Approved non-unique indexes
      const statusIndex = indexes.find(([fields]) => fields.status === 1);
      const prevAppIndex = indexes.find(([fields]) => fields.previousApplicationId === 1);
      const createdAtIndex = indexes.find(([fields]) => fields.createdAt === -1);

      expect(statusIndex, 'Must declare index on status').toBeDefined();
      expect(prevAppIndex, 'Must declare index on previousApplicationId').toBeDefined();
      expect(createdAtIndex, 'Must declare index on createdAt: -1').toBeDefined();

      // Zero unapproved unique indexes on application phone or email (preserves reapplication credential reuse)
      const uniquePhoneIndex = indexes.find(
        ([fields, options]) => fields.phone !== undefined && options?.unique === true,
      );
      const uniqueEmailIndex = indexes.find(
        ([fields, options]) => fields.email !== undefined && options?.unique === true,
      );

      expect(
        uniquePhoneIndex,
        'PartnerApplicationModel must NOT declare unique index on phone',
      ).toBeUndefined();
      expect(
        uniqueEmailIndex,
        'PartnerApplicationModel must NOT declare unique index on email',
      ).toBeUndefined();
    });
  });

  describe('2. PartnerModel Default Status & coverageVersion Guard', () => {
    it('defaults newly constructed documents to PENDING_VERIFICATION', () => {
      const newPartner = new PartnerModel({
        businessName: 'Unassigned Test Partner',
        phone: '+919876500001',
      });

      expect(newPartner.status).toBe('PENDING_VERIFICATION');
    });

    it('supports all four existing PartnerStatus enum values explicitly', () => {
      const validStatuses = ['ACTIVE', 'INACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED'] as const;

      for (const status of validStatuses) {
        const partner = new PartnerModel({
          businessName: `Partner ${status}`,
          phone: '+919876500002',
          status,
        });

        const error = partner.validateSync();
        expect(error, `Status "${status}" should validate`).toBeUndefined();
        expect(partner.status).toBe(status);
      }
    });

    it('rejects unsupported status values on PartnerModel', () => {
      const badPartner = new PartnerModel({
        businessName: 'Bad Status Partner',
        phone: '+919876500003',
        status: 'SUBMITTED' as unknown as 'ACTIVE', // Application status, invalid on operational partner
      });

      const error = badPartner.validateSync();
      expect(error).toBeDefined();
      expect(error?.errors.status).toBeDefined();
    });

    it('defaults coverageVersion to 0 and validates as required non-negative number', () => {
      const partner = new PartnerModel({
        businessName: 'Guarded Partner',
        phone: '+919876500004',
      });

      expect(partner.coverageVersion).toBe(0);

      const error = partner.validateSync();
      expect(error).toBeUndefined();
    });

    it('rejects negative coverageVersion numbers', () => {
      const partner = new PartnerModel({
        businessName: 'Negative Guard Partner',
        phone: '+919876500005',
        coverageVersion: -1,
      });

      const error = partner.validateSync();
      expect(error).toBeDefined();
      expect(error?.errors.coverageVersion).toBeDefined();
    });
  });

  describe('3. ServiceAreaModel guardVersion Guard', () => {
    it('defaults guardVersion to 0 and validates as required non-negative number', () => {
      const serviceArea = new ServiceAreaModel({
        code: 'TEST-BLR-NORTH',
        name: 'Bangalore North Hub',
        city: 'Bengaluru',
        state: 'Karnataka',
        countryCode: 'IN',
        pincodes: ['560001', '560002'],
      });

      expect(serviceArea.guardVersion).toBe(0);

      const error = serviceArea.validateSync();
      expect(error).toBeUndefined();
    });

    it('rejects negative guardVersion numbers', () => {
      const serviceArea = new ServiceAreaModel({
        code: 'TEST-BLR-SOUTH',
        name: 'Bangalore South Hub',
        city: 'Bengaluru',
        state: 'Karnataka',
        countryCode: 'IN',
        pincodes: ['560003'],
        guardVersion: -1,
      });

      const error = serviceArea.validateSync();
      expect(error).toBeDefined();
      expect(error?.errors.guardVersion).toBeDefined();
    });

    it('preserves existing ServiceAreaModel validations and pincode rules', () => {
      const invalidArea = new ServiceAreaModel({
        code: 'BLR',
        name: 'Bangalore Hub',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['123'], // Invalid PIN code (must be 6 digits)
      });

      const error = invalidArea.validateSync();
      expect(error).toBeDefined();
      expect(error?.errors.pincodes).toBeDefined();
    });
  });

  describe('4. Regression Assertions on UserModel Identity Indexes', () => {
    it('preserves compound unique index on UserModel { phone: 1, userType: 1 }', () => {
      const indexes = UserModel.schema.indexes();
      const compoundPhone = indexes.find(
        ([fields, options]) =>
          fields.phone === 1 && fields.userType === 1 && options?.unique === true,
      );

      expect(compoundPhone).toBeDefined();
    });

    it('preserves global sparse unique index on UserModel { email: 1 }', () => {
      const indexes = UserModel.schema.indexes();
      const sparseEmail = indexes.find(
        ([fields, options]) =>
          fields.email === 1 && options?.unique === true && options?.sparse === true,
      );

      expect(sparseEmail).toBeDefined();
    });
  });
});
