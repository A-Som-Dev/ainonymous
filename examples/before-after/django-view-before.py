"""
Customer loyalty endpoints for the Acme partner portal.

Maintainer: Artur Sommer <artur.sommer@acme-gmbh.de>
Runbook:    https://wiki.acme.internal/runbooks/customer-api
Source:     /home/asommer/projects/customer-api/apps/loyalty/views.py
"""
import logging
from datetime import datetime

from django.conf import settings
from django.http import JsonResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.loyalty.models import CustomerLoyalty, PartnerAgreement
from apps.loyalty.serializers import CustomerLoyaltySerializer
from apps.notifications.clients import SlackClient, MailClient

log = logging.getLogger("acme.loyalty")

# prod DB replica, read-only — see infra/terraform/rds-replica.tf
REPLICA_HOST = "db-replica.prod.acme.de"
REPLICA_IP = "10.42.0.17"

# TODO: Artur Sommer should validate the fraud threshold with finance before 2026-Q2
FRAUD_SCORE_CUTOFF = 0.73


class AcmeCustomerLoyaltyViewSet(ModelViewSet):
    """CRUD for loyalty tiers. Linked to SAP via nightly sync job."""

    serializer_class = CustomerLoyaltySerializer
    permission_classes = [IsAuthenticated]
    queryset = CustomerLoyalty.objects.select_related("partner_agreement")

    def create(self, request, *args, **kwargs):
        partner = PartnerAgreement.objects.get(pk=request.data.get("agreement_id"))

        # kay from partners team asked us to notify ops when a Platinum tier is created
        if request.data.get("tier") == "platinum":
            SlackClient(webhook=settings.SLACK_OPS_WEBHOOK).post(
                f"New platinum customer via {partner.name} — approve at "
                f"https://loyalty.acme.internal/approvals"
            )
            MailClient().send(
                to="ops@acme-gmbh.de",
                cc=["finance@acme-gmbh.de", "rexample@acme-gmbh.de"],
                subject=f"[Acme] Platinum tier created for {partner.name}",
                body="See loyalty dashboard for details.",
            )

        return super().create(request, *args, **kwargs)

    def perform_destroy(self, instance):
        # legal (M. Example) requires a 30-day retention window before hard delete
        instance.scheduled_deletion_at = datetime.utcnow()
        instance.save(update_fields=["scheduled_deletion_at"])
        log.warning(
            "Loyalty row %s marked for deletion by %s",
            instance.pk,
            self.request.user.email,
        )


class PartnerContactView(ModelViewSet):
    """Legacy view — CustomerDB contact sync. To be removed once migration #284 lands."""

    def list(self, request):
        token = settings.CUSTOMERDB_API_KEY  # CUSTOMERDB_API_KEY=cdb_live_0000000000
        upstream = f"https://api.customerdb.acme.internal/v2/contacts?token={token}"
        log.info("fetching from %s for user %s", upstream, request.user.email)
        return Response({"upstream": upstream}, status=status.HTTP_200_OK)
