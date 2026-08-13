import type { Tour } from '../ShowAndTellContext';

export const createInvoiceTour: Tour = {
  id:          'create-invoice',
  title:       'Create Invoice',
  icon:        '🧾',
  description: 'Walk through creating a complete vendor invoice end-to-end.',
  steps: [
    {
      id:          'intro',
      note:        "Welcome to Show & Tell: Create Invoice! 🎬\n\nWe'll walk through creating a real vendor invoice together. You'll fill in each field as we go. Click Next to begin.",
      noteColor:   'blue',
      noteRotation: -2,
    },
    {
      id:         'navigate',
      note:       "Navigating to Manage Invoices — your AP invoice hub where all invoices are created, tracked, and paid.",
      noteColor:  'yellow',
      autoNextMs: 2200,
      action:     async ({ navigate }) => { navigate('/ap/manage-invoices'); },
    },
    {
      id:        'business-unit',
      note:      "Select the Business Unit.\n\nThis determines the legal entity the invoice will be booked against. Choose from the list.",
      noteColor: 'yellow',
      targetId:  'invoice-business-unit',
      // Click the antd Select selector to open the dropdown
      autoClick: '[data-sat-id="invoice-business-unit"] .ant-select-selector',
    },
    {
      id:        'supplier',
      note:      "Select the Supplier.\n\nClick the field to open the supplier search. Find your vendor by name or supplier number.",
      noteColor: 'yellow',
      targetId:  'invoice-supplier',
      // Click the Input which calls openSupplierModal
      autoClick: '[data-sat-id="invoice-supplier"] input',
    },
    {
      id:        'invoice-number',
      note:      "Enter the Invoice Number.\n\nUse the number from the supplier's physical document. This must be unique per supplier.",
      noteColor: 'green',
      targetId:  'invoice-number',
      // Focus the input so the user can start typing immediately
      autoClick: '[data-sat-id="invoice-number"] input',
    },
    {
      id:        'invoice-date',
      note:      "Set the Invoice Date.\n\nThis is the date printed on the supplier's invoice — not the date you received it.",
      noteColor: 'green',
      targetId:  'invoice-date',
      // Click the date picker input to open the calendar
      autoClick: '[data-sat-id="invoice-date"] input',
    },
    {
      id:        'invoice-amount',
      note:      "Enter the Invoice Amount.\n\nThis is the total billed by the supplier. It must equal the sum of all line items you add below.",
      noteColor: 'green',
      targetId:  'invoice-amount',
      autoClick: '[data-sat-id="invoice-amount"] input',
    },
    {
      id:        'invoice-lines',
      note:      "Add Invoice Lines.\n\nEach line breaks down what was purchased — description, amount, and GL account. The total of all lines must match the header amount above.",
      noteColor: 'pink',
      targetId:  'invoice-lines-table',
    },
    {
      id:        'save',
      note:      "Save the Invoice.\n\nOnce all fields are filled and valid, click Save. The invoice will be stored as Unpaid and ready for payment processing.",
      noteColor: 'blue',
      targetId:  'invoice-save-button',
      noteRotation: 1.5,
    },
    {
      id:          'complete',
      note:        "🎉 Invoice created!\n\nThe invoice is now in the system as Unpaid. Next steps:\n• Pay in Full — from Invoice Actions menu\n• Create Payment — from Manage Payments\n• Approve — via Initiate Approval",
      noteColor:   'green',
      noteRotation: -1,
    },
  ],
};
