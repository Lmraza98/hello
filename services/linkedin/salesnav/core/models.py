"""Typed result models for Sales Navigator scraping."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass
class EmployeeResult:
    name: str
    title: str | None = None
    sales_nav_url: str | None = None
    public_url: str | None = None
    has_public_url: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class CompanyResult:
    company_name: str
    industry: str | None = None
    employee_count_display: str | None = None
    employee_count_int: int | None = None
    linkedin_url: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ContactsResult:
    company_name: str
    domain: str
    employees: list[EmployeeResult]
    status: str

    def to_dict(self) -> dict:
        return {
            "company_name": self.company_name,
            "domain": self.domain,
            "employees": [employee.to_dict() for employee in self.employees],
            "status": self.status,
        }
