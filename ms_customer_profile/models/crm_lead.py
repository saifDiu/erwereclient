from odoo import api, fields, models, tools, _


class CrmLead(models.Model):
    _inherit = 'crm.lead'
    _rec_names_search = ['name', 'partner_name', 'contact_name', 'email_from', 'enquiry_reference_id']

    enquiry_reference_id = fields.Char(
        string='Enquiry ID', copy=False, readonly=True, index=True,
        help="Auto-generated unique enquiry reference, e.g. ENQ-2026-04-00001.")

    account_type = fields.Selection(
        [('end_customer', 'End Customer'), ('reseller', 'Reseller')],
        string='Promotional Type', tracking=True, index=True,
        default='end_customer')

    source_website_id = fields.Many2one(
        'website', string='Source Website', index=True,
        help="The connected website this enquiry was submitted from.")

    enquiry_product_ids = fields.One2many(
        'ms_customer.enquiry_product', 'lead_id', string='Enquiry Products')
    product_count = fields.Integer(
        string='# Products', compute='_compute_product_count', store=True)

    @api.depends('enquiry_product_ids')
    def _compute_product_count(self):
        for lead in self:
            lead.product_count = len(lead.enquiry_product_ids)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('enquiry_reference_id'):
                vals['enquiry_reference_id'] = self.env['ir.sequence'].next_by_code(
                    'ms_customer.enquiry') or '/'
            if not vals.get('source_website_id') and self.env.context.get('website_id'):
                vals['source_website_id'] = self.env.context['website_id']
        leads = super().create(vals_list)
        leads._ms_customer_ensure_partner()
        leads._ms_customer_notify_country_mailbox()
        return leads

    def _ms_customer_ensure_partner(self):
        """Auto-create or link a res.partner for the enquiry contact."""
        Partner = self.env['res.partner'].sudo()
        for lead in self:
            if lead.partner_id or not lead.email_from:
                continue
            normalized = tools.email_normalize(lead.email_from)
            if not normalized:
                continue
            partner = Partner.search([('email_normalized', '=', normalized)], limit=1)
            if not partner:
                partner = Partner.create({
                    'name': lead.contact_name or lead.partner_name or normalized,
                    'email': normalized,
                    'company_name': lead.partner_name or False,
                    'country_id': lead.country_id.id or False,
                    'phone': lead.phone or False,
                    'account_type': lead.account_type or 'end_customer',
                })
            lead.partner_id = partner.id

    def _ms_customer_notify_country_mailbox(self):
        """If a per-country delivery email is configured, send a notification
        email to that mailbox using the country-tagged sender address."""
        ConfigEnv = self.env['ms_customer.country_email_config'].sudo()
        Mail = self.env['mail.mail'].sudo()
        for lead in self:
            if not lead.country_id:
                continue
            config = ConfigEnv._get_for_country(lead.country_id, lead.company_id)
            if not config:
                continue
            ref = lead.enquiry_reference_id or str(lead.id)
            subject = _("[Enquiry %s] %s — %s",
                        ref,
                        lead.country_id.name,
                        lead.contact_name or lead.partner_name or lead.email_from or '')
            body_html = self._ms_customer_render_notification_html(lead, ref)
            Mail.create({
                'subject': subject,
                'body_html': body_html,
                'email_from': config.mailbox_email,
                'email_to': config.mailbox_email,
                'model': 'crm.lead',
                'res_id': lead.id,
                'auto_delete': True,
            }).send()

    def _ms_customer_render_notification_html(self, lead, ref):
        rows = [
            ('Enquiry ID', ref),
            ('Date', fields.Datetime.to_string(lead.create_date) if lead.create_date else ''),
            ('Company', lead.partner_name or ''),
            ('Contact', lead.contact_name or ''),
            ('Email', lead.email_from or ''),
            ('Phone', lead.phone or ''),
            ('Country', lead.country_id.name or ''),
            ('Promotional Type', dict(self._fields['account_type'].selection).get(lead.account_type, '') if lead.account_type else ''),
            ('Source Website', lead.source_website_id.name or ''),
            ('# Products', str(lead.product_count or 0)),
        ]
        rows_html = ''.join(
            '<tr><td style="padding:4px 12px 4px 0;color:#666;">%s</td><td style="padding:4px 0;"><b>%s</b></td></tr>' % (k, tools.html_escape(v))
            for k, v in rows
        )
        return (
            '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#333;">'
            '<p>A new enquiry has been received.</p>'
            '<table>%s</table>'
            '</div>'
        ) % rows_html

    def website_form_input_filter(self, request, values):
        values = super().website_form_input_filter(request, values)
        if not values.get('source_website_id') and getattr(request, 'website', False):
            values['source_website_id'] = request.website.id
        return values
