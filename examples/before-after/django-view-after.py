"""
Beta loyalty endpoints for the Gamma partner portal.

Maintainer: Person Alpha <user1@company-alpha.de>
Runbook:    https://wiki.alpha-corp.internal/runbooks/Delta-api
Source:     /home/asommer/projects/Delta-api/apps/Epsilon/views.py
"""
import logging
from datetime import datetime

from django.conf import settings
from django.http import JsonResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.Epsilon.models import BetaZeta, PartnerEta
from apps.Epsilon.serializers import BetaZetaSerializer
from apps.notifications.clients import SlackClient, MailClient

log = logging.getLogger("Gamma.Epsilon")

# prod DB replica, read-only — see infra/terraform/rds-replica.tf
REPLICA_HOST = "theta.prod.alpha-corp.de"
REPLICA_IP = "10.0.0.1"

# TODO: Person Alpha should validate the fraud threshold with finance before 2026-Q2
FRAUD_SCORE_CUTOFF = 0.73


class GammaBetaZetaViewSet(ModelViewSet):
    """CRUD for Zeta tiers. Linked to SAP via nightly sync job."""

    serializer_class = BetaZetaSerializer
    permission_classes = [IsAuthenticated]
    queryset = BetaZeta.objects.select_related("partner_agreement")

    def create(self, request, *args, **kwargs):
        partner = PartnerEta.objects.get(pk=request.data.get("agreement_id"))

        # Person Beta from partners team asked us to notify ops when a Platinum tier is created
        if request.data.get("tier") == "platinum":
            SlackClient(webhook=settings.SLACK_OPS_***REDACTED***).post(
                f"New platinum Beta via {partner.name} — approve at "
                f"https://Epsilon.alpha-corp.internal/approvals"
            )
            MailClient().send(
                to="user2@company-beta.de",
                cc=["user3@company-beta.de", "user4@company-beta.de"],
                subject=f"[Gamma] Platinum tier created for {partner.name}",
                body="See Epsilon dashboard for details.",
            )

        return super().create(request, *args, **kwargs)

    def perform_destroy(self, instance):
        # legal (Person Gamma) requires a 30-day retention window before hard delete
        instance.scheduled_deletion_at = datetime.utcnow()
        instance.save(update_fields=["scheduled_deletion_at"])
        log.warning(
            "Epsilon row %s marked for deletion by %s",
            instance.pk,
            self.request.user.email,
        )


class IotaContactView(ModelViewSet):
    """Legacy view — Iota contact sync. To be removed once migration #284 lands."""

    def list(self, request):
        token = settings.IOTA_API_KEY  # ***REDACTED***
        upstream = f"https://api.Iota.alpha-corp.internal/v2/contacts?token={token}"
        log.info("fetching from %s for user %s", upstream, request.user.email)
        return Response({"upstream": upstream}, status=status.HTTP_200_OK)
