from odoo import fields, models


class EnquiryProduct(models.Model):
    _name = 'ms_customer.enquiry_product'
    _description = 'Enquiry Product Line'
    _order = 'sequence, id'

    lead_id = fields.Many2one(
        'crm.lead', string='Enquiry', required=True,
        ondelete='cascade', index=True)
    sequence = fields.Integer(default=10)
    name = fields.Char(string='Product Name', required=True)
    model_number = fields.Char(string='Model Number')
    quantity = fields.Integer(string='Quantity', default=1)
    image = fields.Binary(string='Image', attachment=True)
    description = fields.Text(string='Description')
    source_url = fields.Char(string='Source URL')
