from odoo import fields, models, api
from odoo.exceptions import ValidationError
import re

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


class CountryEmailConfig(models.Model):
    _name = 'ms_customer.country_email_config'
    _description = 'Per-Country Enquiry Delivery Email'
    _order = 'country_id'
    _rec_name = 'mailbox_email'

    country_id = fields.Many2one(
        'res.country', string='Country', required=True, ondelete='cascade')
    mailbox_email = fields.Char(
        string='Mailbox Email', required=True,
        help="Email address that receives enquiry notifications for this country and is used as the sender of the country-tagged notifications (e.g. uk@papachina.com).")
    company_id = fields.Many2one(
        'res.company', string='Company',
        default=lambda self: self.env.company, required=True)
    active = fields.Boolean(default=True)
    notes = fields.Char(string='Internal Notes')

    _sql_constraints = [
        ('country_company_unique',
         'unique(country_id, company_id)',
         'Only one delivery email can be configured per country per company.'),
    ]

    @api.constrains('mailbox_email')
    def _check_mailbox_email(self):
        for rec in self:
            if rec.mailbox_email and not EMAIL_RE.match(rec.mailbox_email.strip()):
                raise ValidationError("Mailbox email must be a valid email address.")

    @api.model
    def _get_for_country(self, country, company=None):
        if not country:
            return self.browse()
        company = company or self.env.company
        return self.search([
            ('country_id', '=', country.id),
            ('company_id', '=', company.id),
            ('active', '=', True),
        ], limit=1)
