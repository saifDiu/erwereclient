from odoo import http, _
from odoo.exceptions import AccessError, MissingError
from odoo.http import request


class CustomerProfilePortal(http.Controller):

    @http.route(['/customer/profile/<int:partner_id>'],
                type='http', auth='public', website=True, sitemap=False)
    def customer_super_link(self, partner_id, access_token=None, **kw):
        partner_sudo = request.env['res.partner'].sudo().browse(partner_id)
        if not partner_sudo.exists():
            return request.render('ms_customer_profile.portal_invalid_link')

        if not access_token or access_token != partner_sudo.access_token:
            try:
                request.env['res.partner'].browse(partner_id).check_access('read')
            except (AccessError, MissingError):
                return request.render('ms_customer_profile.portal_invalid_link')

        if partner_sudo.is_blocked:
            return request.render('ms_customer_profile.portal_blocked', {
                'partner': partner_sudo,
            })

        values = {
            'partner': partner_sudo,
            'page_name': 'customer_profile',
        }
        return request.render('ms_customer_profile.portal_customer_profile', values)
