{
    'name': 'PapaChina Customer Profile & Enquiries',
    'version': '19.0.1.0.0',
    'category': 'Sales/CRM',
    'summary': 'Customer profiles with portal super-link and enquiry dashboard for PapaChina workplace',
    'description': """
PapaChina Customer Profile & Enquiry Management
=================================================
Section 1 — Customer Management
Section 2 — All Enquiry List

Features:
 * Customer profile with End Customer / Reseller account type
 * Auto-creation of profile from website enquiries
 * Unique portal super-link per customer
 * Smart email domain detection with free-webmail filtering
 * Industry & block/unblock management
 * Customer Service group with view-only access (no delete)
 * Enquiry dashboard pulling from PapaChina + WooCommerce websites
 * Auto-generated enquiry reference IDs
 * Per-country delivery email configuration
""",
    'author': 'PapaChina',
    'website': 'https://www.papachina.com',
    'license': 'LGPL-3',
    'depends': [
        'base',
        'contacts',
        'mail',
        'portal',
        'crm',
        'website',
        'website_crm',
    ],
    'data': [
        'security/res_groups.xml',
        'security/ir.model.access.csv',
        'data/ir_sequence_data.xml',
        'data/free_webmail_data.xml',
        'views/free_webmail_views.xml',
        'views/country_email_config_views.xml',
        'views/customer_block_history_views.xml',
        'views/res_partner_views.xml',
        'views/crm_lead_views.xml',
        'views/portal_templates.xml',
        'views/menus.xml',
    ],
    'installable': True,
    'application': True,
    'auto_install': False,
}
